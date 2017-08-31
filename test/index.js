import Plugin from '../src';
import fs from 'fs';
import _ from 'lodash';
import {parse, transform, traverse, types as t} from 'babel-core';

const defaultBabelSettings = {
  presets: ["es2015"],
  plugins: [
    "transform-flow-strip-types",
    "syntax-async-functions",
    "transform-regenerator"
  ]
};

function load(basename) {
  const filename = `${__dirname}/fixtures/${basename}.js`;
  return fs.readFileSync(filename, 'utf8');
}

function save(basename, transformedWithPlugin, settings) {
  let additionalName = settings !== defaultBabelSettings ? `.${JSON.stringify(settings).replace(/"/g, '\'').replace(/:/g, '_')}`: '';
  fs.writeFileSync(`${__dirname}/processed/${basename}${additionalName}.js`, transform(transformedWithPlugin.code).code)
}

function countHoisted(newAst, isOrigin = false) {
  let diffManual = 0,
    diffAutoGenerated = 0;
  traverse(newAst, {
    Function: {
      enter(path) {
        if (path.node._hoisted) {
          if (!!path.node.loc) {
            diffManual++;
          } else {
            diffAutoGenerated++;
          }
        }
      }
    }
  });
  return [diffManual, diffAutoGenerated];
}

function needConcatArray(objValue, srcValue) {
  if (_.isArray(objValue)) {
    return objValue.concat(srcValue);
  }
}

function runTest(basename, numberToRemove, expectedResult, settings = defaultBabelSettings) {
  if (!Array.isArray(numberToRemove)) {
    numberToRemove = [numberToRemove, 0]
  }
  const source = load(basename);
  const transformedWithPlugin = transform(
    source,
    _.mergeWith(
      {
        plugins: [
          Plugin,
          "transform-es2015-modules-commonjs"
        ]
      },
      settings,
      needConcatArray
    )
  );

  //console.log(transformedWithPlugin.code);
  //save(basename, transformedWithPlugin, settings);

  const [diffManual, diffAutoGenerated] = countHoisted(transformedWithPlugin.ast);
  diffManual.should.equal(numberToRemove[0], 'manual function');
  diffAutoGenerated.should.equal(numberToRemove[1], 'auto-generated function');
  if (expectedResult) {
    const context = {
      exports: {}
    };
    const loaded = new Function('module', 'exports', transformedWithPlugin.code);
    loaded(context, context.exports);
    const result = typeof context.exports.default === 'function' ? context.exports.default() : context.exports.default;
    result.should.eql(expectedResult);
  }
}

function eliminate(basename, numberToRemove, result, settings) {
  let settingsName = settings ? ` with settings ${JSON.stringify(settings)}` : '';
  it(`should eliminate ${numberToRemove} closure(s) from "${basename}"${settingsName}`, function () {
    runTest(basename, numberToRemove, result, settings);
  });
}

eliminate.only = function (basename: string, numberToRemove: number, result, settings) {
  let settingsName = settings ? ` with settings ${JSON.stringify(settings)}` : '';
  it.only(`should eliminate ${numberToRemove} closure(s) from "${basename}"${settingsName}`, function () {
    try {
      runTest(basename, numberToRemove, result, settings);
    }
    catch (e) {
      if (e.name !== 'AssertionError') {
        console.error(e.stack);
      }
      throw e;
    }
  });
};

function extractPath(scope) {
  const parts = [];
  do {
    parts.unshift(scope.block.type);
  }
  while (scope = scope.parent);
  return parts.join(' ');
}

describe('Closure Elimination', function () {
  eliminate("simple", 1);
  eliminate("twice", 2);
  eliminate("complex", 14);
  eliminate("inner-1", 2);
  eliminate("no-hoist", 0);
  eliminate("inner-2", 3);
  eliminate("nope", 0);
  eliminate("arrow-this", 1);
  eliminate("arrow-this", 1, undefined, {});
  eliminate("arrow-this-nested", 2);
  eliminate("arrow-this-nested", 2, undefined, {});
  eliminate("arrow-this-deep-nested", 3, 222);
  eliminate("class", [1, 2], 'bar');
  eliminate("class", 1, 'bar', {});
  eliminate("declaration", 2);
  eliminate("shadow-declaration", 2);
  eliminate("iife", 0);
  eliminate("class-compiled", 4);
  eliminate("class-complex", [2, 2], [2, 3, 4]);
  eliminate("class-complex", 2, [2, 3, 4], {});
  eliminate("extended-class-from-outer-parent", [2, 2], [["foo", Date.prototype.getDate], ["bar", Date.prototype.getDate]]);
  eliminate("extended-class-from-outer-parent", 2, [["foo", Date.prototype.getDate], ["bar", Date.prototype.getDate]], {});
  eliminate("extended-class-from-known-class", [2, 2], [["base", "foo"], ["base", "bar"]]);
  eliminate("extended-class-from-known-class", 2, [["base", "foo"], ["base", "bar"]], {});
  eliminate("generator", 1, ["foo", 1, 2, 3]);
  eliminate("async", [1, 1], true);
  eliminate("create-class", [1, 2], ['foo', 'bar']);
  eliminate("create-class", 1, ['foo', 'bar'], {presets: ['babel-preset-es2015-node5']});
  eliminate("create-class", 1, ['foo', 'bar'], {});
  eliminate("assign-expression", [2, 0], [3, 2, "yo", 2, 1]);
  eliminate("assign-expression-and-referenced", 0, [1, [1, 1], [123]]);
  eliminate("possible-scope-hoisting", 1, [1]);
  eliminate("object-shorthand-func", [1, 2], [1, 2, 3]);
  eliminate("object-shorthand-func", 1, [1, 2, 3], {plugins: ["transform-es2015-destructuring"]});
  eliminate("no-function-scope", [1, 0], 'bar');
  eliminate("assign-expression-array-pattern", 0, 2);
  eliminate("eval-deopt", 0, 'bar');
  eliminate("eval-no-deopt", 1, 'bar');
  eliminate("no-module", 2, 'baz');
  eliminate("no-module", 1, 'baz', {parserOpts: {sourceType: 'script'}});
  eliminate("this-in-async-arrow", [0, 1], undefined, {"presets": ["latest"]});
  eliminate("self-use-declaration", 2, [6, 6], {});
  eliminate("no-block-statement", 0, [["foo","bar"],"bar1"], {});
  //eliminate("jquery-3.1.1", 122, undefined, {parserOpts: {sourceType: 'script'}, compact: false});//need only for performance check
  eliminate("same-name-in-parent-scope", 3, ['foo', 'bar'], {});
  eliminate("issue-25", [1, 2]);
  eliminate("issue-25", 1, null, {});
  eliminate("issue-25", [1, 1], null, {plugins:["transform-async-to-generator"]});
  eliminate("issue-26", [1, 1], ['foo', 'bar']);
  eliminate("issue-26", 1, ['foo', 'bar'], {});
  eliminate("issue-28-minimal", 1, [0, 1], {"plugins": ['transform-regenerator']});
});

