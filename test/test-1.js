const Bluetooth = require('node-web-bluetooth');

const UUID_SERVICE = '0000ffe0-0000-1000-8000-00805f9b34fb';
const UUID_CHARACTERISTIC = '0000ffe1-0000-1000-8000-00805f9b34fb';

class SelectFirstFoundDevice extends Bluetooth.RequestDeviceDelegate {

  // Select first device found
  onAddDevice(device) {
    console.log(device.toString());
    console.log(JSON.stringify(device));
    this.resolve(device);
  }
  onUpdateDevice(device) {
    // Called whenever new advertisement data was received
    // for the device
    console.log(device);
  }

  // Time-out when device hasn't been found in 20 secs
  onStartScan() {
    this._timer = setTimeout(() => {
      this.reject(new Error('No device found'));
      process.exit();
    }, 20000);
  }
  onStopScan() {
    if (this._timer) clearTimeout(this._timer);
  }
}

async function connect() {
  const device = await Bluetooth.requestDevice({
      filters: [{
        services: [0xffe0]
      }],
      delegate: new SelectFirstFoundDevice()
    })
    .then(device => device.gatt.connect())
    .then(server => {
      // Getting Battery Service...
      console.log('Server');
      return server.getPrimaryService(0xffe0);
    })
    .then(service => {
      console.log('Getting Characteristics...');
      // Get all characteristics.
      return service.getCharacteristics();
    })
    .then(characteristics => {
      console.log('> Characteristics: ' +
        characteristics.map(c => c.uuid).join('\n' + ' '.repeat(19)));
    })
    .catch(error => {
      console.log(error);
    });
}
connect();
