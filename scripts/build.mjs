import fs from 'node:fs/promises';
import path from 'node:path';
const from = path.resolve('node_modules/@ffmpeg/ffmpeg/dist/umd');
const to = path.resolve('public/vendor/ffmpeg');
await fs.mkdir(to,{recursive:true});
for (const filename of ['ffmpeg.js','814.ffmpeg.js']) {
  await fs.copyFile(path.join(from,filename),path.join(to,filename));
  console.log(`Ready: ${path.join('public/vendor/ffmpeg',filename)}`);
}
