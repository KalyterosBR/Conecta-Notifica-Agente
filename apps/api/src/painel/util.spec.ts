import { normalizarTelefone } from './util';

describe('normalizarTelefone', () => {
  it('aceita o que a secretaria digita na planilha', () => {
    expect(normalizarTelefone('(81) 99999-0000')).toBe('+5581999990000');
    expect(normalizarTelefone('81999990000')).toBe('+5581999990000');
    expect(normalizarTelefone('+55 81 99999 0000')).toBe('+5581999990000');
    expect(normalizarTelefone('55 81 99999-0000')).toBe('+5581999990000');
  });

  it('aceita fixo com e sem DDI', () => {
    expect(normalizarTelefone('(81) 3333-0000')).toBe('+558133330000');
    expect(normalizarTelefone('558133330000')).toBe('+558133330000');
  });

  it('recusa o que não dá para confiar, em vez de cadastrar torto', () => {
    expect(normalizarTelefone('99999-0000')).toBeNull(); // sem DDD
    expect(normalizarTelefone('')).toBeNull();
    expect(normalizarTelefone('não tem')).toBeNull();
    expect(normalizarTelefone('123')).toBeNull();
  });

  it('número internacional com + é preservado', () => {
    expect(normalizarTelefone('+351 912 345 678')).toBe('+351912345678');
  });
});
