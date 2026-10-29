import { describe, it, expect } from 'vitest';
import { texToSpeech, unicodeToSpeech, mathTextToSpeech, fractionWords, scienceToSpeech, formulaToSpeech } from './mathSpeech';
import { speakable } from '../components/Listen';

describe('maths speech', () => {
  it('reads Unicode symbols', () => {
    expect(unicodeToSpeech('An angle of 45°')).toBe('An angle of 45 degrees');
    expect(unicodeToSpeech('Area = 50 cm²')).toBe('Area equals 50 square centimetres');
    expect(unicodeToSpeech('Volume 8 m³')).toBe('Volume 8 cubic metres');
    expect(unicodeToSpeech('C = 2πr')).toBe('C equals 2 pi r');
    expect(unicodeToSpeech('3 × 4 ÷ 2')).toBe('3 times 4 divided by 2');
    expect(unicodeToSpeech('x² + y³')).toBe('x squared plus y cubed');
    expect(unicodeToSpeech('√49 and √(a+b)')).toBe('the square root of 49 and the square root of a+b');
    expect(unicodeToSpeech('x ≤ 5, y ≥ 2')).toBe('x is less than or equal to 5, y is greater than or equal to 2');
    expect(unicodeToSpeech('∠ABC is acute')).toBe('angle A B C is acute');
    expect(unicodeToSpeech('bearing 060°')).toBe('bearing 060 degrees');
  });
  it('reads plus and minus between terms, not hyphens', () => {
    expect(unicodeToSpeech('∠SON = 180° - 45° = 135°')).toBe('angle S O N equals 180 degrees minus 45 degrees equals 135 degrees');
    expect(unicodeToSpeech('x = (90° - x) + 10°')).toBe('x equals (90 degrees minus x) plus 10 degrees');
    expect(unicodeToSpeech('a well-known right-angled triangle')).toBe('a well-known right-angled triangle');
  });
  it('reads fractions but not dates', () => {
    expect(fractionWords('3', '4')).toBe('three quarters');
    expect(fractionWords('1', '2')).toBe('one half');
    expect(fractionWords('7', '15')).toBe('7 over 15');
    expect(unicodeToSpeech('take 3/4 of it')).toBe('take three quarters of it');
    expect(unicodeToSpeech('on 12/10/2026')).toBe('on 12/10/2026');
  });
  it('reads LaTeX', () => {
    expect(texToSpeech('45^\\circ')).toBe('45 degrees');
    expect(texToSpeech('a^2 + b^2 = c^2')).toBe('a squared plus b squared equals c squared');
    expect(texToSpeech('\\frac{3}{4}')).toBe('three quarters');
    expect(texToSpeech('\\frac{\\text{Opposite}}{\\text{Hypotenuse}}')).toBe('Opposite over Hypotenuse');
    expect(texToSpeech('3 \\times 4')).toBe('3 times 4');
    expect(texToSpeech('2\\pi r')).toBe('2 pi r');
    expect(texToSpeech('\\sqrt{25} = 5')).toBe('the square root of 25 equals 5');
    expect(texToSpeech('\\angle ABC = 90^{\\circ}')).toBe('angle A B C equals 90 degrees');
    expect(texToSpeech('\\sin \\theta')).toBe('sine theta');
    expect(texToSpeech('x \\leq 5')).toBe('x is less than or equal to 5');
    expect(texToSpeech('x^{3}')).toBe('x cubed');
    expect(texToSpeech('\\vec{a}')).toBe('vector a');
  });
  it('handles mixed text and leaves prices alone', () => {
    expect(mathTextToSpeech('The angle is $60^\\circ$ here.')).toBe('The angle is 60 degrees here.');
    expect(mathTextToSpeech('It costs $5 and $10.')).toBe('It costs $5 and $10.');
    expect(mathTextToSpeech('Pay GH¢20.')).toBe('Pay GH¢20.');
    expect(mathTextToSpeech('\\sin \\theta = \\frac{4}{5}')).toBe('sine theta equals four fifths');
    expect(speakable('**Area** of $\\frac{1}{2} \\times b \\times h$')).toBe('Area of one half times b times h');
  });
});

describe('science notation', () => {
  it('reads chemical formulas letter by letter', () => {
    expect(scienceToSpeech('H₂O')).toBe('H 2 O'); expect(scienceToSpeech('CO₂ and O₂')).toBe('C O 2 and O 2');
    expect(scienceToSpeech('CO2 is a gas')).toBe('C O 2 is a gas'); expect(scienceToSpeech('NaCl')).toBe('N A C L');
    expect(scienceToSpeech('CaCO3')).toBe('C A C O 3'); expect(scienceToSpeech('Ca(OH)₂')).toBe('C A O H 2'); expect(scienceToSpeech('Na⁺')).toBe('N A plus'); expect(scienceToSpeech('Ca²⁺ and Cl⁻')).toBe('C A 2 plus and C L minus');
    expect(formulaToSpeech('H2SO4')).toBe('H 2 S O 4');
  });
  it('leaves ordinary words, codes and labels alone', () => {
    expect(scienceToSpeech('Carbon is in Coal.')).toBe('Carbon is in Coal.'); expect(scienceToSpeech('Use A4 paper in Year 1.')).toBe('Use A4 paper in Year 1.');
    expect(scienceToSpeech('See Section 2 A and Activity 1 B.')).toBe('See Section 2 A and Activity 1 B.'); expect(scienceToSpeech('I am OK')).toBe('I am OK');
  });
  it('reads temperatures and units', () => {
    expect(unicodeToSpeech('Water boils at 100 °C.')).toBe('Water boils at 100 degrees Celsius.'); expect(unicodeToSpeech('It was 25°C')).toBe('It was 25 degrees Celsius');
    expect(unicodeToSpeech('a speed of 5 m/s')).toBe('a speed of 5 metres per second'); expect(unicodeToSpeech('g = 9.8 m/s²')).toBe('g equals 9.8 metres per second squared');
    expect(unicodeToSpeech('2 kg of sand and 1 kg of salt')).toBe('2 kilograms of sand and 1 kilogram of salt');
    expect(unicodeToSpeech('a volume of 10 cm³')).toBe('a volume of 10 cubic centimetres'); expect(unicodeToSpeech('density 2.7 g/cm³')).toBe('density 2.7 grams per cubic centimetre');
    expect(unicodeToSpeech('a 1.5 V cell and 0.2 A')).toBe('a 1.5 volts cell and 0.2 amperes'); expect(unicodeToSpeech('a force of 10 N')).toBe('a force of 10 newtons');
    expect(unicodeToSpeech('in 30 s')).toBe('in 30 seconds');
  });
  it('reads LaTeX chemistry', () => {
    expect(mathTextToSpeech('Water is $\\text{H}_2\\text{O}$.')).toBe('Water is H 2 O.'); expect(mathTextToSpeech('$\\mathrm{CO_2}$ is released')).toBe('C O 2 is released');
    expect(mathTextToSpeech('$\\ce{CO2 + H2O}$')).toBe('C O 2 plus H 2 O'); expect(mathTextToSpeech('$25^\\circ\\text{C}$')).toBe('25 degrees Celsius');
  });
});

describe('biology speech', () => {
  it('reads micrometres, magnification and filial generations', () => {
    expect(scienceToSpeech('A cell is 20 µm wide')).toContain('20 micrometres');
    expect(scienceToSpeech('viewed at ×400 under the microscope')).toContain('times 400');
    expect(scienceToSpeech('the F1 generation')).toContain('F 1');
    expect(scienceToSpeech('C₆H₁₂O₆ + 6O₂')).toContain('C 6 H 12 O 6');
  });
});

describe('additional mathematics speech', () => {
  it('reads logs, limits, integrals, derivatives, combinations, matrices, sets and logic', () => {
    expect(texToSpeech('\\log_{2} 8 = 3')).toBe('log base 2 of 8 equals 3');
    expect(texToSpeech('\\lim_{x \\to 2} f(x)')).toBe('the limit as x tends to 2 of f(x)');
    expect(texToSpeech('\\int_{0}^{1} x^2 dx')).toBe('the integral from 0 to 1 of x squared dx');
    expect(texToSpeech('\\frac{dy}{dx} = 2x')).toBe('d y by d x equals 2x');
    expect(texToSpeech('\\binom{5}{2} = 10')).toBe('5 choose 2 equals 10');
    expect(texToSpeech('^{n}C_{r}')).toBe('n choose r');
    expect(texToSpeech('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}')).toBe('the matrix with rows 1, 2; 3, 4');
    expect(texToSpeech('\\begin{pmatrix} 3 \\\\ 4 \\end{pmatrix}')).toBe('column 3, 4');
    expect(texToSpeech("A \\cup B")).toBe('A union B');
    expect(texToSpeech('f^{-1}(x)')).toBe('f inverse (x)');
    expect(texToSpeech('(f \\circ g)(x)')).toBe('(f composed with g)(x)');
    expect(texToSpeech('p \\land q')).toBe('p and q');
    expect(texToSpeech('45^\\circ')).toBe('45 degrees');
    expect(unicodeToSpeech('A ∩ B = ∅')).toBe('A intersection B equals the empty set');
    expect(unicodeToSpeech('log2 8 = 3')).toBe('log base 2 of 8 equals 3');
  });
});
