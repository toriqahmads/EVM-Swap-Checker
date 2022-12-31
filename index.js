process.env.TZ = 'Asia/Jakarta';

const Checker = require('./checker');

(async() => {
  try {
    const checker = new Checker();
    const result = await checker.getSwapAtFromTransaction('0x2b1d2c9c20535c51404000b3414280854136ef55c21e60ddab226f18e15e9a76');
    console.log('result', result);
  } catch (error) {
    console.error(error);
  }
})();
