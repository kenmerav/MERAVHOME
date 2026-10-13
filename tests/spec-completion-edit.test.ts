import { expect, it } from "vitest";
import { completionDetailValue } from "@/lib/specCompletionDetail";
it('validates real amounts, zero prices and an explicit price basis', () => {
  expect(completionDetailValue('price', { value: '$1,250.50', priceUnit: 'unit' })).toEqual({ price: '$1250.50', price_unit: 'unit' });
  expect(completionDetailValue('price', { value: '0', priceUnit: 'sq_ft' }).price).toBe('$0.00');
  for (const value of ['', '-5', 'ask vendor', '3.141', 'Infinity']) expect(() => completionDetailValue('price', { value, priceUnit: 'unit' })).toThrow();
  expect(() => completionDetailValue('price', { value: '250' })).toThrow('Choose whether');
  expect(() => completionDetailValue('color', { value: 'TBD' })).toThrow();
  expect(completionDetailValue('color', { value: ' Brushed brass ' })).toEqual({ color: 'Brushed brass' });
});
