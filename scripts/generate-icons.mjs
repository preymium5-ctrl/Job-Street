import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const source = await readFile(new URL("../public/brand/jobstreet-croatia-ribbon.png", import.meta.url));
const raster = (size) => sharp(source).resize(size, size, { fit: "contain", background: "#FFFFFF" }).flatten({ background: "#FFFFFF" }).png().toBuffer();
await writeFile(new URL("../app/icon.svg", import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#FFFFFF"/><image width="512" height="512" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${source.toString("base64")}"/></svg>\n`);

await writeFile(new URL("../app/icon1.png", import.meta.url), await raster(192));
await writeFile(new URL("../app/apple-icon.png", import.meta.url), await raster(180));

// Every browser size uses the same opaque white background as the SVG and PNG icons.
const sizes = [16, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(raster));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (let index = 0; index < sizes.length; index++) {
  const entry = 6 + index * 16;
  directory[entry] = directory[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
await writeFile(new URL("../app/favicon.ico", import.meta.url), Buffer.concat([directory, ...images]));
console.log("Generated white-background favicon (six sizes), SVG, 192px PNG and 180px Apple icon.");
