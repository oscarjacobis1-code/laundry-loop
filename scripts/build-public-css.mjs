import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const inputPath = path.resolve("styles/public-tailwind.css");
const outputPath = path.resolve("public/public-tailwind.css");
const input = await readFile(inputPath, "utf8");
const result = await postcss([tailwindcss()]).process(input, { from: inputPath, to: outputPath });

await writeFile(outputPath, result.css);
