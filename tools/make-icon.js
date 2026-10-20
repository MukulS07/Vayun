// Builds the window icon (PNG) from the Vayun logo art. Run: electron tools/make-icon.js <logo.webp> <out.png>
// Chromium decodes WebP; the mark is cropped from the centre of the art and drawn on a rounded dark tile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const [src, out] = process.argv.slice(-2).map(p => path.resolve(p));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  const dataUrl = 'data:image/webp;base64,' + fs.readFileSync(src).toString('base64');
  const png = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d');
      g.fillStyle = '#050606'; g.beginPath(); g.roundRect(0, 0, S, S, 56); g.fill(); g.clip();
      const side = img.width * 0.40, cx = img.width * 0.497, cy = img.height * 0.40;
      g.drawImage(img, cx - side / 2, cy - side / 2, side, side, 0, 0, S, S);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('decode failed'));
    img.src = ${JSON.stringify(dataUrl)};
  })`);
  fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  console.log('wrote', out);
  app.quit();
});
