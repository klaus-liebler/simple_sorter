import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { inlineSingleFileMinifyPlugin } from "./scripts/postbuild-singlefile-minify.js";

export default defineConfig({
	plugins: [viteSingleFile(), inlineSingleFileMinifyPlugin()],
	build: {
		target: "esnext"
	}
});