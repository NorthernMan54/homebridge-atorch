import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

import { atorchService } from './atorchService';
import createDebug from 'debug';
import debugEnable from 'debug';

const debug = createDebug('ATorch:platform');

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */

interface DiscoveryTopicMap { topic: string, type: string, uniq_id: string, uuid: string }

export class atorchPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  public readonly services: atorchSwitchService[] | atorchLightService[] | atorchSensorService[] | atorchBinarySensorService[] = [];
  private discoveryTopicMap: DiscoveryTopicMap[] = [];

  // Auto removal of non responding devices

  private cleanup: any;
  private timeouts = {};
  private timeoutCounter = 1;
  private debug: any;
  // public statusEvent = {};

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    this.cleanup = this.config['cleanup'] || 24; // Default removal of defunct devices after 24 hours
    this.debug = this.config['debug'] || false;

    if (this.debug) {

      let namespaces = debugEnable.disable();

      // this.log("DEBUG-1", namespaces);
      if (namespaces) {
        namespaces = namespaces + ',ATorch*';
      } else {
        namespaces = 'ATorch*';
      }
      // this.log("DEBUG-2", namespaces);
      debugEnable.enable(namespaces);
    }

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    accessory.context.timeout = this.autoCleanup(accessory);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {

    debug('discoverDevices');
    // EXAMPLE ONLY
    // A real plugin you would discover accessories from the local network, cloud services
    // or a user-defined array in the platform config.

    const mqttHost = new Mqtt(this.config);

    // debug('MqttHost', mqttHost);

    mqttHost.on('Remove', (topic) => {
      // debug('remove-0', topic);
      if (this.discoveryTopicMap[topic]) {
        const existingAccessory = this.accessories.find(accessory => accessory.UUID === this.discoveryTopicMap[topic].uuid);
        if (existingAccessory) {
          // debug('Remove', this.discoveryTopicMap[topic]);
          switch (this.discoveryTopicMap[topic].type) {
            case 'Service':
              this.serviceCleanup(this.discoveryTopicMap[topic].uniq_id, existingAccessory);
              break;
            case 'Accessory':
              this.accessoryCleanup(this.discoveryTopicMap[topic].uuid, existingAccessory);
              break;
          }
          delete this.discoveryTopicMap[topic];
        } else {
          debug('missing accessory', topic, this.discoveryTopicMap[topic]);
        }

      } else {
        // debug('Remove failed', topic);
      }

    });

    mqttHost.on('Discovered', (topic, config) => {
      debug('Discovered ->', topic, config.name, config);

      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const message = normalizeMessage(config);
      // debug('normalizeMessage ->', message);
      const identifier = message.dev.ids[0];      // Unique per accessory
      const uniq_id = message.uniq_id;            // Unique per service

      const uuid = this.api.hap.uuid.generate(identifier);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        // the accessory already exists

        this.log.info('Found existing accessory:', message.name);
        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`

        existingAccessory.context.mqttHost = mqttHost;
        existingAccessory.context.device[uniq_id] = message;

        this.discoveryTopicMap[topic] = { topic: topic, type: 'Service', uniq_id: uniq_id, uuid: uuid };

        if (this.services[uniq_id]) {
          this.log.warn('Restoring existing service from cache:', message.name);
          this.services[uniq_id].refresh();
          switch (message.atorchType) {
            case 'sensor':
              if (!message.dev_cla) { // This is the device status topic
                this.discoveryTopicMap[topic] = { topic: topic, type: 'Accessory', uniq_id: uniq_id, uuid: uuid };
              } else {
                this.discoveryTopicMap[topic] = { topic: topic, type: 'Service', uniq_id: uniq_id, uuid: uuid };
              }
              // debug('discoveryTopicMap', this.discoveryTopicMap[topic]);
              break;
            default:
              this.discoveryTopicMap[topic] = { topic: topic, type: 'Service', uniq_id: uniq_id, uuid: uuid };
          }
        } else {
          this.log.info('Creating service:', message.name, message.atorchType);
          switch (message.atorchType) {
            case 'sensor':
              this.services[uniq_id] = new atorchSensorService(this, existingAccessory, uniq_id);
              if (!message.dev_cla) { // This is the device status topic
                this.discoveryTopicMap[topic] = { topic: topic, type: 'Accessory', uniq_id: uniq_id, uuid: uuid };
              } else {
                this.discoveryTopicMap[topic] = { topic: topic, type: 'Service', uniq_id: uniq_id, uuid: uuid };
              }
              // debug('discoveryTopicMap', this.discoveryTopicMap[topic]);
              break;
            case 'light':
              this.services[uniq_id] = new atorchLightService(this, existingAccessory, uniq_id);
              this.discoveryTopicMap[topic] = { topic: topic, type: 'Service', uniq_id: uniq_id, uuid: uuid };
              break;
            case 'switch':
              this.services[uniq_id] = new atorchSwitchService(this, existingAccessory, uniq_id);
              this.discoveryTopicMap[topic] = { topic: topic, type: 'Service', uniq_id: uniq_id, uuid: uuid };
              break;
            case 'binary_sensor':
              this.services[uniq_id] = new atorchBinarySensorService(this, existingAccessory, uniq_id);
              this.discoveryTopicMap[topic] = { topic: topic, type: 'Service', uniq_id: uniq_id, uuid: uuid };
              break;
            default:
              this.log.warn('Warning: Unhandled ATorch device type', message.atorchType);
          }
        }

        this.api.updatePlatformAccessories([existingAccessory]);

      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', message.name);

        // create a new accessory
        const accessory = new this.api.platformAccessory(message.name, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = {};
        accessory.context.device[uniq_id] = message;
        accessory.context.mqttHost = mqttHost;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        switch (message.atorchType) {
          case 'switch':
            this.services[uniq_id] = new atorchSwitchService(this, accessory, uniq_id);
            this.discoveryTopicMap[topic] = { topic: topic, type: 'Service', uniq_id: uniq_id, uuid: uuid };
            break;
          case 'light':
            this.services[uniq_id] = new atorchLightService(this, accessory, uniq_id);
            this.discoveryTopicMap[topic] = { topic: topic, type: 'Service', uniq_id: uniq_id, uuid: uuid };
            break;
          case 'sensor':
            this.services[uniq_id] = new atorchSensorService(this, accessory, uniq_id);
            if (!message.dev_cla) { // This is the device status topic
              this.discoveryTopicMap[topic] = { topic: topic, type: 'Accessory', uniq_id: uniq_id, uuid: uuid };
            } else {
              this.discoveryTopicMap[topic] = { topic: topic, type: 'Service', uniq_id: uniq_id, uuid: uuid };
            }
            break;
          case 'binary_sensor':
            this.services[uniq_id] = new atorchBinarySensorService(this, accessory, uniq_id);
            this.discoveryTopicMap[topic] = { topic: topic, type: 'Service', uniq_id: uniq_id, uuid: uuid };
            break;
          default:
            this.log.warn('Warning: Unhandled ATorch device type', message.atorchType);
        }
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.push(accessory);

      }
    });
  }

  serviceCleanup(uniq_id: string, existingAccessory: PlatformAccessory) {
    debug('serviceCleanup', uniq_id);
    if (this.services[uniq_id].service) {
      this.log.info('Removing Service', this.services[uniq_id].service.displayName);

      if (this.services[uniq_id].statusSubscribe) {
        // debug("Cleaned up listeners", mqttHost);
        // debug(this.services[uniq_id].statusSubscribe.event);
        existingAccessory.context.mqttHost.removeAllListeners(this.services[uniq_id].statusSubscribe.event);
        existingAccessory.context.mqttHost.removeAllListeners(this.services[uniq_id].availabilitySubscribe.event);
        // debug("Cleaned up listeners", existingAccessory.context.mqttHost);
      }

      existingAccessory.removeService(this.services[uniq_id].service);
      delete this.services[uniq_id];
      this.api.updatePlatformAccessories([existingAccessory]);
    } else {
      debug('No service', uniq_id);
    }
  }

  accessoryCleanup(uuid: string, existingAccessory: PlatformAccessory) {
    this.log.info('Removing Accessory', existingAccessory.displayName);
    // debug('Services', this.services);
    // debug('Accessory', this.discoveryTopicMap[topic]);

    // debug('FILTER', this.services.filter(x => x.UUID === this.discoveryTopicMap[topic].uuid));

    const services = this.services;
    const output: string[] = [];

    Object.keys(services).some((k: any) => {
      // debug(k);
      // debug(services[k].accessory.UUID);
      if (uuid === services[k].accessory.UUID) {
        output.push(k);
        // this.serviceCleanup(k);
      }
    });

    // debug('list', output);

    output.forEach(element => {
      this.serviceCleanup(element, existingAccessory);
    });

    // Remove accessory
    this.accessories.splice(this.accessories.findIndex(accessory => accessory.UUID === uuid), 1);
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
  }

  //

  autoCleanup(accessory: PlatformAccessory) {
    let timeoutID;

    // debug("autoCleanup", accessory.displayName, accessory.context.timeout, this.timeouts);

    if (accessory.context.timeout) {
      timeoutID = accessory.context.timeout;
      clearTimeout(this.timeouts[timeoutID]);
      delete this.timeouts[timeoutID];

    }

    timeoutID = this.timeoutCounter++;
    this.timeouts[timeoutID] = setTimeout(this.unregister.bind(this), this.cleanup * 60 * 60 * 1000, accessory, timeoutID);

    return (timeoutID);
  }

  unregister(accessory: PlatformAccessory, timeoutID) {
    this.log.error('Removing %s', accessory.displayName);
    this.timeouts[timeoutID] = null;
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    // callback();
  }
}

/* The various ATorch firmware's have a slightly different flavors of the message. */


function normalizeMessage(message) {

  const translation = {
    unique_id: 'uniq_id',
    device_class: 'dev_cla',
    payload_on: 'pl_on',
    payload_off: 'pl_off',
    device: 'dev',
    model: 'mdl',
    sw_version: 'sw',
    manufacturer: 'mf',
    identifiers: 'ids',
  };

  message = renameKeys(message, translation);

  if (message['~']) {
    message = replaceStringsInObject(message, '~', message['~']);
  }

  if (message.stat_t === 'sonoff/tele/STATE' || message.stat_t === 'atorch/tele/STATE') {
    console.log('ERROR: %s has an incorrectly configure MQTT Topic, please make it unique.', message.name);
  }

  return (message);
}

function replaceStringsInObject(obj, findStr, replaceStr, cache = new Map()) {
  if (cache && cache.has(obj)) {
    return cache.get(obj);
  }

  const result = {};

  cache && cache.set(obj, result);

  for (const [key, value] of Object.entries(obj)) {
    let v: any = null;

    if (typeof value === 'string') {
      v = value.replace(RegExp(findStr, 'gi'), replaceStr);
    } else if (Array.isArray(value)) {
      // debug('isArray', value);
      v = value;
      // for (var i = 0; i < value.length; i++) {
      //    v[i] = replaceStringsInObject(value, findStr, replaceStr, cache);
      // }
    } else if (typeof value === 'object') {
      // debug('object', value);
      v = replaceStringsInObject(value, findStr, replaceStr, cache);
    } else {
      v = value;
    }
    result[key] = v;
  }

  return result;
}

function renameKeys(o, mapShortToLong) {
  let build, key, destKey, value;

  if (Array.isArray(o)) {
    build = [];
  } else {
    build = {};
  }
  for (key in o) {
    // Get the destination key
    destKey = mapShortToLong[key] || key;

    // Get the value
    value = o[key];

    // If this is an object, recurse
    if (typeof value === 'object') {
      // debug('recurse', value);
      value = renameKeys(value, mapShortToLong);
    }

    // Set it on the result using the destination key
    build[destKey] = value;
  }
  return build;
}
