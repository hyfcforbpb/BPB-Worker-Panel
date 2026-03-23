import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname as pathDirname } from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';
import { globSync } from 'glob';
import { minify as jsMinify } from 'terser';
import { minify as htmlMinify } from 'html-minifier';
import JSZip from "jszip";
import obfs from 'javascript-obfuscator';
import pkg from '../package.json' with { type: 'json' };
import { gzipSync } from 'zlib';

const env = process.env.NODE_ENV || 'mangle';
const mangleMode = env === 'mangle';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

const ASSET_PATH = join(__dirname, '../src/assets');
const DIST_PATH = join(__dirname, '../dist/');

const green = '\x1b[32m';
const red = '\x1b[31m';
const reset = '\x1b[0m';

const success = `${green}✔${reset}`;
const failure = `${red}✗${reset}`;

const version = pkg.version;

async function processHtmlPages() {
    const indexFiles = globSync('**/index.html', { cwd: ASSET_PATH });
    const result = {};

    for (const relativeIndexPath of indexFiles) {
        const dir = pathDirname(relativeIndexPath);
        const base = (file) => join(ASSET_PATH, dir, file);

        const indexHtml = readFileSync(base('index.html'), 'utf8');
        let finalHtml = indexHtml.replaceAll('__VERSION__', version);

        if (dir !== 'error') {
            const styleCode = readFileSync(base('style.css'), 'utf8');
            const scriptCode = readFileSync(base('script.js'), 'utf8');
            // 压缩内部脚本
            const finalScriptCode = await jsMinify(scriptCode, {
                compress: { dead_code: true, drop_console: true }
            });
            finalHtml = finalHtml
                .replaceAll('__STYLE__', `<style>${styleCode}</style>`)
                .replaceAll('__SCRIPT__', finalScriptCode.code);
        }

        const minifiedHtml = htmlMinify(finalHtml, {
            collapseWhitespace: true,
            removeAttributeQuotes: true,
            minifyCSS: true,
            removeComments: true
        });

        // 使用 Gzip 压缩 HTML 内容并转为 Base64 隐藏原始字符
        const compressed = gzipSync(minifiedHtml);
        const htmlBase64 = compressed.toString('base64');
        result[dir] = JSON.stringify(htmlBase64);
    }

    console.log(`${success} Assets bundled successfully!`);
    return result;
}

function generateJunkCode() {
    const minVars = 50, maxVars = 200;
    const minFuncs = 30, maxFuncs = 100;

    const varCount = Math.floor(Math.random() * (maxVars - minVars + 1)) + minVars;
    const funcCount = Math.floor(Math.random() * (maxFuncs - minFuncs + 1)) + minFuncs;

    const junkVars = Array.from({ length: varCount }, (_, i) => {
        const varName = `_0x_v${Math.random().toString(36).substring(2, 8)}_${i}`;
        return `let ${varName} = ${Math.random() > 0.5 ? Math.floor(Math.random() * 1000) : '"' + Math.random().toString(36).substring(5) + '"'};`;
    }).join('\n');

    const junkFuncs = Array.from({ length: funcCount }, (_, i) => {
        const funcName = `_0x_f${Math.random().toString(36).substring(2, 8)}_${i}`;
        return `function ${funcName}() { return ${Math.random() > 0.5 ? 'true' : 'false'}; }`;
    }).join('\n');

    return `${junkVars}\n${junkFuncs}\n`;
}

async function buildWorker() {
    const htmls = await processHtmlPages();
    const faviconBuffer = readFileSync('./src/assets/favicon.ico');
    const faviconBase64 = faviconBuffer.toString('base64');

    // 1. 使用 Esbuild 进行初始捆绑
    const buildResult = await build({
        entryPoints: [join(__dirname, '../src/worker.ts')],
        bundle: true,
        format: 'esm',
        write: false,
        external: ['cloudflare:sockets'],
        platform: 'browser',
        target: 'esnext',
        loader: { '.ts': 'ts' },
        define: {
            __PANEL_HTML_CONTENT__: htmls['panel'] ?? '""',
            __LOGIN_HTML_CONTENT__: htmls['login'] ?? '""',
            __ERROR_HTML_CONTENT__: htmls['error'] ?? '""',
            __SECRETS_HTML_CONTENT__: htmls['secrets'] ?? '""',
            __PROXY_IP_HTML_CONTENT__: htmls['proxy-ip'] ?? '""',
            __ICON__: JSON.stringify(faviconBase64),
            __VERSION__: JSON.stringify(version)
        }
    });

    console.log(`${success} Worker code bundled!`);

    let finalCode;
    const rawCode = buildResult.outputFiles[0].text;

    if (mangleMode) {
        // 快速模式：垃圾代码注入 + 基础压缩
        const junkCode = generateJunkCode();
        const minified = await jsMinify(junkCode + rawCode, {
            module: true,
            compress: { passes: 2, dead_code: true }
        });
        finalCode = minified.code;
    } else {
        // 深度模式：高级混淆保护
        console.log(`正在进行高级混淆保护...`);
        const obfuscationResult = obfs.obfuscate(rawCode, {
            compact: true,
            controlFlowFlattening: true, // 控制流平坦化，让逻辑跳转极其混乱
            controlFlowFlatteningThreshold: 0.6,
            deadCodeInjection: true, // 死代码注入
            deadCodeInjectionThreshold: 0.3,
            debugProtection: true, // 开启防调试，尝试打开控制台会导致无限循环或崩溃
            debugProtectionInterval: 3000,
            disableConsoleOutput: false, 
            identifierNamesGenerator: 'hexadecimal', // 变量名转为十六进制字符
            log: false,
            numbersToExpressions: true, // 数字转为复杂的数学表达式
            renameGlobals: false, // 必须为 false 以确保 Worker 的 export default 不被破坏
            rotateStringArray: true, // 字符串数组循环旋转
            selfDefending: true, // 自我防御，代码被美化/格式化后将无法运行
            splitStrings: true, // 字符串拆分
            splitStringsChunkLength: 6,
            stringArray: true,
            stringArrayCallsTransform: true,
            stringArrayEncoding: ['base64', 'rc4'], // 关键：使用 RC4 加密字符串数组
            stringArrayThreshold: 1,
            transformObjectKeys: true, // 对象属性名混淆
            unicodeEscapeSequence: true, // 使用 Unicode 转义
            // 保护 Cloudflare Workers 环境及网络通信关键变量
            reservedNames: [
                'fetch', 
                'WebSocket', 
                'Response', 
                'Request', 
                'URL', 
                'addEventListener', 
                'env', 
                'ctx', 
                'connect', // cloudflare:sockets
                'readable', 
                'writable'
            ],
            target: "browser"
        });

        console.log(`${success} Worker obfuscated (RC4 + Flow Flattening)!`);
        finalCode = obfuscationResult.getObfuscatedCode();
    }

    const buildTimestamp = new Date().toISOString();
    const buildInfo = `// Build: ${buildTimestamp}\n`;
    const worker = `${buildInfo}// @ts-nocheck\n${finalCode}`;
    
    // 写入文件
    mkdirSync(DIST_PATH, { recursive: true });
    writeFileSync('./dist/worker.js', worker, 'utf8');

    // 打包成 Zip (用于直接上传 Cloudflare 仪表盘或作为备份)
    const zip = new JSZip();
    zip.file('_worker.js', worker);
    const nodebuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE'
    });
    writeFileSync('./dist/worker.zip', nodebuffer);

    console.log(`${success} Build pipeline finished!`);
}

buildWorker().catch(err => {
    console.error(`${failure} Build process encountered an error:`, err);
    process.exit(1);
});
