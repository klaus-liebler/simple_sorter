import type { Plugin } from "vite";
import type { OutputBundle, OutputAsset } from "rolldown";
import { minify as minifyHtml } from "html-minifier-terser";
import { minify as minifyJs } from "terser";

function isIdentChar(char: string): boolean {
	return /[A-Za-z0-9_$]/.test(char);
}

function skipQuotedString(code: string, startIndex: number, quote: string): number {
	let i = startIndex + 1;
	while (i < code.length) {
		const ch = code[i];
		if (ch === "\\") {
			i += 2;
			continue;
		}
		if (ch === quote) return i + 1;
		i += 1;
	}
	return i;
}

function skipBlockComment(code: string, startIndex: number): number {
	let i = startIndex + 2;
	while (i + 1 < code.length) {
		if (code[i] === "*" && code[i + 1] === "/") return i + 2;
		i += 1;
	}
	return i;
}

function skipLineComment(code: string, startIndex: number): number {
	let i = startIndex + 2;
	while (i < code.length && code[i] !== "\n") i += 1;
	return i;
}

function skipTemplateLiteral(code: string, startIndex: number): number {
	let i = startIndex + 1;
	while (i < code.length) {
		const ch = code[i];
		if (ch === "\\") {
			i += 2;
			continue;
		}
		if (ch === "`") return i + 1;
		if (ch === "$" && code[i + 1] === "{") {
			i = skipJsExpression(code, i + 2);
			continue;
		}
		i += 1;
	}
	return i;
}

function skipJsExpression(code: string, startIndex: number): number {
	let i = startIndex;
	let depth = 1;

	while (i < code.length && depth > 0) {
		const ch = code[i]!;
		const next = code[i + 1];

		if (ch === '"' || ch === "'" || ch === "`") {
			i = ch === "`" ? skipTemplateLiteral(code, i) : skipQuotedString(code, i, ch);
			continue;
		}

		if (ch === "/" && next === "*") {
			i = skipBlockComment(code, i);
			continue;
		}

		if (ch === "/" && next === "/") {
			i = skipLineComment(code, i);
			continue;
		}

		if (ch === "{") depth += 1;
		if (ch === "}") depth -= 1;
		i += 1;
	}

	return i;
}

interface ParsedTemplate {
	endIndex: number;
	parts: string[];
	expressions: string[];
}

function parseTaggedTemplate(code: string, backtickIndex: number): ParsedTemplate | null {
	let i = backtickIndex + 1;
	let literal = "";
	const parts: string[] = [];
	const expressions: string[] = [];

	while (i < code.length) {
		const ch = code[i]!;

		if (ch === "\\") {
			literal += code.slice(i, i + 2);
			i += 2;
			continue;
		}

		if (ch === "`") {
			parts.push(literal);
			return { endIndex: i + 1, parts, expressions };
		}

		if (ch === "$" && code[i + 1] === "{") {
			parts.push(literal);
			literal = "";
			const expressionStart = i + 2;
			const afterExpression = skipJsExpression(code, expressionStart);
			const expressionEnd = afterExpression - 1;
			expressions.push(code.slice(expressionStart, expressionEnd));
			i = afterExpression;
			continue;
		}

		literal += ch;
		i += 1;
	}

	return null;
}

function minifyCssFragment(cssText: string): string {
	return cssText
		.replace(/\s+/g, " ")
		.replace(/\s*([{}:;,>])\s*/g, "$1")
		.replace(/;}/g, "}")
		.trim();
}

async function minifyTemplateByTag(
	tagName: string,
	parts: string[],
	expressions: string[]
): Promise<string> {
	const placeholders = expressions.map((_, index) => `__EXPR_${index}__`);
	let withPlaceholders = parts[0] ?? "";
	for (let i = 0; i < expressions.length; i += 1) {
		withPlaceholders += placeholders[i] + (parts[i + 1] ?? "");
	}

	let minifiedLiteral: string;
	if (tagName === "P") {
		minifiedLiteral = await minifyHtml(withPlaceholders, {
			collapseWhitespace: true,
			collapseInlineTagWhitespace: true,
			removeComments: true,
			caseSensitive: true,
			minifyCSS: true
		});
	} else {
		minifiedLiteral = minifyCssFragment(withPlaceholders);
	}

	let rebuilt = minifiedLiteral;
	for (let i = 0; i < expressions.length; i += 1) {
		rebuilt = rebuilt.replace(placeholders[i]!, `\${${expressions[i]}}`);
	}

	return `\`${rebuilt}\``;
}

async function minifyLitTaggedTemplates(scriptCode: string): Promise<string> {
	let result = "";
	let i = 0;

	while (i < scriptCode.length) {
		const ch = scriptCode[i]!;
		if (ch !== "o" && ch !== "P") {
			result += ch;
			i += 1;
			continue;
		}

		const prev = scriptCode[i - 1] ?? "";
		const next = scriptCode[i + 1] ?? "";
		if ((prev && isIdentChar(prev)) || next !== "`") {
			result += ch;
			i += 1;
			continue;
		}

		const parsed = parseTaggedTemplate(scriptCode, i + 1);
		if (!parsed) {
			result += ch;
			i += 1;
			continue;
		}

		const template = await minifyTemplateByTag(ch, parsed.parts, parsed.expressions);
		result += ch + template;
		i = parsed.endIndex;
	}

	return result;
}

async function minifyInlineModuleScripts(htmlSource: string): Promise<string> {
	const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
	let result = "";
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = scriptPattern.exec(htmlSource)) !== null) {
		const fullMatch = match[0];
		const attrs = match[1] ?? "";
		const scriptCode = match[2] ?? "";
		const start = match.index;
		const end = start + fullMatch.length;
		const isModule = /\btype\s*=\s*"module"/i.test(attrs);

		result += htmlSource.slice(lastIndex, start);

		if (!isModule) {
			result += fullMatch;
			lastIndex = end;
			continue;
		}

		const literalMinifiedCode = await minifyLitTaggedTemplates(scriptCode);

		const jsMinified = await minifyJs(literalMinifiedCode, {
			ecma: 2020,
			module: true,
			compress: { passes: 2 },
			mangle: true,
			format: { comments: false }
		});

		const finalScriptCode = jsMinified.code ?? literalMinifiedCode;
		result += `<script${attrs}>${finalScriptCode}</script>`;
		lastIndex = end;
	}

	result += htmlSource.slice(lastIndex);
	return result;
}

export function inlineSingleFileMinifyPlugin(): Plugin {
	return {
		name: "inline-singlefile-minify",
		apply: "build",
		enforce: "post",
		async generateBundle(_options, bundle: OutputBundle) {
			const indexHtmlAsset = (Object.values(bundle) as OutputAsset[]).find(
				item => item.type === "asset" && item.fileName === "index.html"
			);

			if (!indexHtmlAsset) return;

			const htmlSource =
				typeof indexHtmlAsset.source === "string"
					? indexHtmlAsset.source
					: Buffer.from(indexHtmlAsset.source).toString("utf8");

			const htmlWithMinifiedScripts = await minifyInlineModuleScripts(htmlSource);
			indexHtmlAsset.source = await minifyHtml(htmlWithMinifiedScripts, {
				collapseWhitespace: true,
				collapseInlineTagWhitespace: true,
				removeComments: true,
				removeRedundantAttributes: true,
				removeScriptTypeAttributes: true,
				removeTagWhitespace: true,
				removeAttributeQuotes: true,
				useShortDoctype: true,
				minifyCSS: true,
				minifyJS: true,
				caseSensitive: true
			});
		}
	};
}
