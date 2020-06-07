import arg from "arg";
import Listr from "listr";
import YAML from "yaml";
const ora = require("ora");
const { readdir, readFile, copyFile, writeFile } = require("fs").promises;
const { existsSync } = require("fs");

function parseRgumentsIntoOptions(rawArgs) {
  const args = arg(
    {
      "--in": String,
      "--out": String,
      "--help": Boolean,
      "--images": String,
      "-i": "--in",
      "-o": "--out",
      "-h": "--help",
      "--img": "--images",
    },
    {
      argv: rawArgs.slice(2),
    }
  );
  return {
    showHelp: args["--help"] || false,
    input: args["--in"],
    imageOut: args["--images"],
    output: args["--out"],
  };
}

function help() {
  return "Usage: migrate-hacksoc-to-gatsby --in <source directory> --out <markdown output directory> --images <images output directory>";
}

async function findInputFiles(input) {
  try {
    return await readdir(input, {
      encoding: "utf8",
    });
  } catch (e) {
    throw e;
  }
}

async function validateDir(path) {
  try {
    const files = await readdir(path);
    if (!files.includes("manifest.yml")) {
      throw new Error("No manifest file in directory");
    }
  } catch (e) {
    throw e;
  }
}

async function validateManifest(path, input) {
  try {
    const rawManifest = await readFile(path, "utf-8");
    const manifest = parseManifest(rawManifest);

    if (!manifest.id) throw new Error("No id");
    if (!manifest.name) throw new Error("No name");
    if (!manifest.start) throw new Error("No start");
    if (!manifest.end) throw new Error("No end");
    if (!manifest.location) throw new Error("No Location");
    if (!manifest.mapLink) throw new Error("No maplink");
    if (!manifest.summary) throw new Error("No summary");
    if (!existsSync(`${input}/${manifest.summary}`))
      throw new Error("Can't open summary");
    if (!manifest.description) throw new Error("No description");
    if (!existsSync(`${input}/${manifest.description}`))
      throw new Error("Can't open description");
    if (!manifest.banner) throw new Error("No banner");
    if (!existsSync(`${input}/${manifest.banner}`))
      throw new Error("Can't open banner");

    return manifest;
  } catch (e) {
    throw e;
  }
}

function parseManifest(file) {
  return YAML.parse(file)[0];
}

async function buildFrontMatter(manifest, input, imageOut) {
  let newManifest = {};

  Object.assign(newManifest, manifest);

  try {
    const summary = (
      await readFile(`${input}/${manifest.summary}`, "utf-8")
    ).split("\n");

    delete newManifest.summary;
    delete newManifest.description;

    const splitBanner = newManifest.banner.split(".");
    const bannerExtension = splitBanner[splitBanner.length - 1];

    newManifest.banner = `${imageOut}/${newManifest.id}-banner.${bannerExtension}`;

    let frontmatter = "---\n";

    for (const [key, value] of Object.entries(newManifest)) {
      frontmatter += `${key}: ${value}\n`;
    }

    frontmatter += `summary: |\n`;

    for (const line of summary) {
      frontmatter += `  ${line}\n`;
    }

    frontmatter += "---\n";

    return frontmatter;
  } catch (e) {
    throw e;
  }
}

async function buildFileContents(frontmatter, input, manifest) {
  try {
    const description = await readFile(
      `${input}/${manifest.description}`,
      "utf-8"
    );

    return (frontmatter += "\n" + description);
  } catch (e) {
    throw e;
  }
}

async function moveBanner(manifest, input, imageOut) {
  try {
    const splitBanner = manifest.banner.split(".");
    const bannerExtension = splitBanner[splitBanner.length - 1];

    const src = `${input}/${manifest.banner}`;
    const dest = `${imageOut}/${manifest.id}-banner.${bannerExtension}`;

    await copyFile(src, dest);
  } catch (e) {
    throw e;
  }
}

async function writeMarkdown(fileContents, manifest, output) {
  try {
    const dest = `${output}/${manifest.id}.md`;
    await writeFile(dest, fileContents);
  } catch (e) {
    throw e;
  }
}

export async function cli(args) {
  const options = parseRgumentsIntoOptions(args);

  if (
    options.showHelp ||
    !options.input ||
    !options.output ||
    !options.imageOut
  ) {
    console.log(help());
    return;
  }

  let inputDirs;
  let lookingForFilesSpinner;

  const input = `${process.cwd()}/${options.input}`;

  try {
    console.clear();
    console.log("HackSoc Website Migration Tool");

    lookingForFilesSpinner = ora("Looking for files in " + input).start();

    inputDirs = await findInputFiles(input);

    lookingForFilesSpinner.succeed("Found " + inputDirs.length + " folders.");
  } catch (e) {
    lookingForFilesSpinner.fail();
    console.error(e.message);
    process.exit(1);
  }

  const tasks = new Listr([], { exitOnError: false });

  for (const dir of inputDirs) {
    tasks.add({
      title: dir,
      task: () =>
        new Listr(
          [
            {
              title: "Validate directory",
              task: async () => await validateDir(`${input}/${dir}`),
            },
            {
              title: "Validate manifest",
              task: async (ctx) =>
                (ctx.manifest = await validateManifest(
                  `${input}/${dir}/manifest.yml`,
                  input
                )),
            },
            {
              title: "Build frontmatter",
              task: async (ctx) =>
                (ctx.frontmatter = await buildFrontMatter(
                  ctx.manifest,
                  input,
                  options.imageOut
                )),
            },
            {
              title: "Build file contents",
              task: async (ctx) =>
                (ctx.fileContents = await buildFileContents(
                  ctx.frontmatter,
                  input,
                  ctx.manifest
                )),
            },
            {
              title: "Copy banner",
              task: async (ctx) =>
                await moveBanner(ctx.manifest, input, options.imageOut),
            },
            {
              title: "Write file contents",
              task: async (ctx) =>
                await writeMarkdown(
                  ctx.fileContents,
                  ctx.manifest,
                  options.output
                ),
            },
          ],
          { exitOnError: true }
        ),
    });
  }

  try {
    tasks.run();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
