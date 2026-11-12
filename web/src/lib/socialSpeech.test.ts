import { describe, it, expect } from 'vitest';
import { socialToSpeech } from './socialSpeech';
import { speakable } from '../components/Listen';
describe('social studies speech', () => {
  it('reads cedis, ranges, circa and abbreviations', () => {
    expect(socialToSpeech('GH₵ 50 and GH¢1')).toBe('50 Ghana cedis and 1 Ghana cedi');
    expect(socialToSpeech('From 1957–1966')).toBe('From 1957 to 1966');
    expect(socialToSpeech('the 18th–19th centuries, c. 1750')).toBe('the 18th to 19th centuries, circa 1750');
    expect(socialToSpeech('The AU, ECOWAS and GES')).toBe('The A U, Ecowas and G E S');
    expect(socialToSpeech('NGOs and SSNIT in Tamale')).toBe("N G O's and Snit in Tah-mah-leh");
    expect(socialToSpeech('WHO WE ARE')).toBe('WHO WE ARE');
    expect(socialToSpeech('Ghana became independent on 6th March, 1957.')).toBe('Ghana became independent on 6th March, 1957.');
    expect(socialToSpeech('Kumasi, Sekondi-Takoradi and Bolgatanga')).toBe('Kumasi, Sekondi-Takoradi and Bolgatanga');
  });
  it('is used by the Listen buttons and leaves science untouched', () => {
    expect(speakable('In 1957, ECOWAS')).toBe('In 1957, Ecowas');
    expect(speakable('The AU, CO and GES')).toBe('The A U, CO and G E S');
    expect(speakable('H₂O at 25 °C')).toContain('degrees Celsius');
  });
});
