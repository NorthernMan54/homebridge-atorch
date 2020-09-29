let AtorchService = require('../node_modules/atorch-service').AtorchService;

var device = AtorchService.requestDevice()
.then(device => {device.connect();
device.on('packet', function(packet) {
  console.log('Packet', packet);
}); });

// console.log(device);

// device.connect();
//

/*
.on('packet', function(packet) {
  console.log('Packet', packet);
});
*/
