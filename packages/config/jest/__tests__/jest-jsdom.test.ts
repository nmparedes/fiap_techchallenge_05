/**
 * @jest-environment jsdom
 */

import { expect, it } from '@jest/globals';

it('provides a browser-like environment for frontend tests', () => {
  const element = document.createElement('div');
  element.textContent = 'FIAP X';

  expect(element.textContent).toBe('FIAP X');
  expect(window.location.href).toBe('http://localhost/');
});
