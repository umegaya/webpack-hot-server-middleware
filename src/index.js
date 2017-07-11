'use strict';

const debug = require('debug')('webpack-hot-server-middleware');
const path = require('path');
const vm = require('vm');
const MultiCompiler = require('webpack/lib/MultiCompiler');
const sourceMapSupport = require('source-map-support');

const DEFAULTS = {
    chunkName: 'main',
    serverRendererOptions: {}
};

function interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj.default : obj;
}

function getFilename(serverStats, outputPath, chunkName) {
    const assetsByChunkName = serverStats.toJson().assetsByChunkName;
    let filename = assetsByChunkName[chunkName] || '';
    // If source maps are generated `assetsByChunkName.main`
    // will be an array of filenames.
    return path.join(
        outputPath,
        Array.isArray(filename)
            ? filename.find(asset => /\.js$/.test(asset))
            : filename
    );
}

function getServerRenderer(filename, buffer, options) {
    const errMessage = `The 'server' compiler must export a function in the form of \`(options) => (req, res, next) => void\``;

    let serverRenderer = interopRequireDefault(
        vm.runInThisContext(buffer.toString())
    );
    if (typeof serverRenderer !== 'function') {
        throw new Error(errMessage);
    }

    serverRenderer = serverRenderer(options);
    if (typeof serverRenderer !== 'function') {
        throw new Error(errMessage);
    }

    return serverRenderer;
}

function installSourceMapSupport(fs) {
    sourceMapSupport.install({
        // NOTE: If https://github.com/evanw/node-source-map-support/pull/149
        // lands we can be less aggressive and explicitly invalidate the source
        // map cache when Webpack recompiles.
        emptyCacheBetweenOperations: true,
        retrieveFile(source) {
            try {
                return fs.readFileSync(source, 'utf8');
            } catch (ex) {
                // Doesn't exist
            }
        }
    });
}

/**
 * Passes the request to the most up to date 'server' bundle.
 * NOTE: This must be mounted after webpackDevMiddleware to ensure this
 * middleware doesn't get called until the compilation is complete.
 * @param   {MultiCompiler} multiCompiler                  e.g webpack([clientConfig, serverConfig])
 * @options {String}        options.chunkName              The name of the main server chunk.
 * @options {Object}        options.serverRendererOptions  Options passed to the `serverRenderer`.
 * @return  {Function}                                     Middleware fn.
 */
function webpackHotServerMiddleware(compiler, options) {
    debug('Using webpack-hot-server-middleware');

    options = Object.assign({}, DEFAULTS, options);

    const outputFs = compiler.outputFileSystem;
    const outputPath = compiler.outputPath;

    installSourceMapSupport(outputFs);

    let serverRenderer;
    let error = false;

    compiler.plugin('done', stats => {
        error = false;
        // Server compilation errors need to be propagated to the client.
        if (stats.compilation.errors.length) {
            error = stats.compilation.errors[0];
            return;
        }
        const filename = getFilename(stats, outputPath, options.chunkName);
        const buffer = outputFs.readFileSync(filename);
        try {
            serverRenderer = getServerRenderer(filename, buffer, options);
        } catch (ex) {
            debug(ex);
            error = ex;
        }
    });

    return (req, res, next) => {
        debug(`Receive request ${req.url}`);
        if (error) {
            return next(error);
        }
        serverRenderer(req, res, next);
    };
}

module.exports = webpackHotServerMiddleware;
