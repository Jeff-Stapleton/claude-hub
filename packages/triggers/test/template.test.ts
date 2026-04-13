import { describe, expect, it } from 'vitest';
import { render } from '../src/template.js';

describe('render', () => {
  it('substitutes dotted paths', () => {
    expect(render('hi {{payload.name}}', { payload: { name: 'jeff' } })).toBe('hi jeff');
  });

  it('supports array indices', () => {
    expect(render('first={{items.0.id}}', { items: [{ id: 'a' }, { id: 'b' }] })).toBe(
      'first=a',
    );
  });

  it('replaces missing paths with empty string', () => {
    expect(render('x={{missing.thing}}', { payload: {} })).toBe('x=');
  });

  it('JSON-stringifies objects and arrays', () => {
    const out = render('p={{payload}}', { payload: { a: 1 } });
    expect(out).toBe('p={"a":1}');
  });

  it('blocks prototype pollution lookups', () => {
    expect(render('x={{payload.__proto__.polluted}}', { payload: {} })).toBe('x=');
    expect(render('x={{payload.constructor.name}}', { payload: {} })).toBe('x=');
  });

  it('ignores keys that do not match the allowed character set', () => {
    // Token itself must match /\w.-/; weird inputs just pass through unmatched.
    expect(render('x={{not a token}}', { payload: {} })).toBe('x={{not a token}}');
  });

  it('coerces numbers and booleans', () => {
    expect(render('n={{n}} b={{b}}', { n: 42, b: true })).toBe('n=42 b=true');
  });
});
