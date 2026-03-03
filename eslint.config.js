import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { 
    files: ["**/*.{js,mjs,cjs}"], 
    plugins: { js }, 
    extends: ["js/recommended"], 
    languageOptions: { globals: globals.node },
    rules: {
			"consistent-return": 2,
			"indent"           : [1, 4],
			"no-else-return"   : 1,
			"semi"             : [1, "always"],
			"space-unary-ops"  : 2
		}
  },
]);
