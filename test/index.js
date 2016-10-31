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

function load (basename) {
  const filename = `${__dirname}/fixtures/${basename}.js`;
  return fs.readFileSync(filename, 'utf8');
}

function collectPositions (ast: Object): Object {
  const collected = {};
  traverse(ast, {
    enter (path) {
      const node = path.node;
      if (path.isFunction()) {
        if(node.loc) {
          collected[JSON.stringify(node.loc)] = extractPath(path.scope);
        } else if(node.body.loc) {
          collected[JSON.stringify(node.body.loc)] = extractPath(path.scope);
        }
      }
    }
  });
  return collected;
}

function countHoisted (oldAst, newAst) {
  const oldPositions = collectPositions(oldAst);
  const newPositions = collectPositions(newAst);
  let total = 0;
  const keys = Object.keys(oldPositions);
  for (let i = 0; i < keys.length; i++) {
    let key = keys[i];
    if(!newPositions[key]) {
      throw new Error('some missed function');
    }
    if (oldPositions[key] !== newPositions[key]) {
      total++;
    }
  }
  return total;
}

function needConcatArray(objValue, srcValue) {
  if (_.isArray(objValue)) {
    return objValue.concat(srcValue);
  }
}

function runTest (basename, numberToRemove, expectedResult, settings = defaultBabelSettings) {
  const source = load(basename);
  const transformedNaked = transform(
    source,
    _.mergeWith(
      {
        plugins: [
          "transform-es2015-modules-commonjs"
        ]
      },
      settings,
      needConcatArray
    )
  );
  //console.log(transformedNaked.code);
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
  const diff = countHoisted(transformedNaked.ast, transformedWithPlugin.ast);
  diff.should.equal(numberToRemove);
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

function eliminate (basename, numberToRemove, result, settings) {
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

function extractPath (scope) {
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
  eliminate("arrow-this-nested", 2);
  eliminate("class", 2, 'bar');
  eliminate("class", 1, 'bar', {});
  eliminate("declaration", 2);
  eliminate("shadow-declaration", 2);
  eliminate("iife", 0);
  eliminate("class-compiled", 4);
  eliminate("class-complex", 3, [2, 3, 4]);
  eliminate("class-complex", 2, [2, 3, 4], {});
  eliminate("extended-class-from-outer-parent", 4, [["foo", RegExp.prototype.test], ["bar", RegExp.prototype.test]]);
  eliminate("extended-class-from-outer-parent", 2, [["foo", RegExp.prototype.test], ["bar", RegExp.prototype.test]], {});
  eliminate("extended-class-from-known-class", 4, [["base", "foo"], ["base", "bar"]]);
  eliminate("extended-class-from-known-class", 2, [["base", "foo"], ["base", "bar"]], {});
  eliminate("generator", 1, ["foo", 1, 2, 3]);
  eliminate("async", 1, true);
  eliminate("create-class", 2, ['foo', 'bar']);
  eliminate("create-class", 1, ['foo', 'bar'], {presets: ['babel-preset-es2015-node5']});
  eliminate("create-class", 1, ['foo', 'bar'], {});
  eliminate("assign-expression", 3, [ 3, 2, "yo", 2, 1 ]);
  eliminate("assign-expression-and-referenced", 0, [ 1, [ 1, 1 ], [ 123 ] ]);
  eliminate("possible-scope-hoisting", 1, [1]);
  eliminate("object-shorthand-func", 3, [1, 2, 3]);
  eliminate("object-shorthand-func", 1, [1, 2, 3], {plugins:["transform-es2015-destructuring"]});
  eliminate("no-function-scope", 1, 'bar');
  eliminate("assign-expression-array-pattern", 0, 2);
  eliminate("eval-deopt", 0, 'bar');
  eliminate("eval-no-deopt", 1, 'bar');
});

