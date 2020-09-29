let device = require('../node_modules/atorch-service').AtorchService;

console.log(device);

device.connect();

device.on('packet', function(packet) {
  console.log('Packet', packet);
})
