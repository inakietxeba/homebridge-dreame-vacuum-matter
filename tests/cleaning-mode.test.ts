import { describe, expect, it } from 'vitest';
import { DreameCleaningModeCodec } from '../src/dreame/cleaning-mode';

describe('DreameCleaningModeCodec', () => {
  it('should use standard cleaning-mode values by default', () => {
    const codec = new DreameCleaningModeCodec();

    expect(codec.encode('SWEEP')).toBe(0);
    expect(codec.encode('MOP')).toBe(1);
    expect(codec.encode('SWEEP_AND_MOP')).toBe(2);
    expect(codec.decode(0)).toBe('SWEEP');
  });

  it('should swap sweep and combined modes for lifting mop pads', () => {
    const codec = new DreameCleaningModeCodec();
    codec.configureLiftingMopPads(true);

    expect(codec.encode('SWEEP')).toBe(2);
    expect(codec.encode('MOP')).toBe(1);
    expect(codec.encode('SWEEP_AND_MOP')).toBe(0);
    expect(codec.decode(0)).toBe('SWEEP_AND_MOP');
    expect(codec.decode(2)).toBe('SWEEP');
  });

  it('should preserve packed upper cleaning-mode settings', () => {
    const codec = new DreameCleaningModeCodec();
    codec.configureLiftingMopPads(true);
    codec.decode(0x140000);

    expect(codec.encode('SWEEP')).toBe(0x140002);
    expect(codec.encode('SWEEP_AND_MOP')).toBe(0x140000);
  });

  it('should learn lifting-mop encoding from live combined cleaning', () => {
    const codec = new DreameCleaningModeCodec();

    codec.observeLiveState(12, 0);

    expect(codec.usesLiftingMopEncoding).toBe(true);
    expect(codec.decode(0)).toBe('SWEEP_AND_MOP');
    expect(codec.encode('SWEEP')).toBe(2);
  });

  it('should learn standard encoding from live combined cleaning', () => {
    const codec = new DreameCleaningModeCodec();
    codec.configureLiftingMopPads(true);

    codec.observeLiveState(12, 2);

    expect(codec.usesLiftingMopEncoding).toBe(false);
    expect(codec.decode(2)).toBe('SWEEP_AND_MOP');
  });
});
