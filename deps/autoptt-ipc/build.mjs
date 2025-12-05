import { execFileSync } from "node:child_process";

process.chdir(import.meta.dirname);

const pluginPath = (process.platform === "win32")
  ? ".\\node_modules\\.bin\\protoc-gen-ts_proto.cmd"
  : "./node_modules/.bin/protoc-gen-ts_proto";

execFileSync("protoc", [
  `--plugin=protoc-gen-ts_proto=${pluginPath}`,
  "--ts_proto_out=.",
  "autoptt.proto",
]);
