import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_BANNER_GUIDANCE,
  guidanceLine,
  shapeMismatch,
  uploadGuidance,
  ZONE_BANNER_GUIDANCE,
} from './upload-guidance';

describe('upload guidance', () => {
  it('follows where each picture is shown', () => {
    expect(uploadGuidance('product-image').ratioLabel).toBe('1:1');
    expect(uploadGuidance('category-image').ratioLabel).toBe('1:1');
    expect(uploadGuidance('banner-image', 'home_hero').recommended).toEqual({
      width: 2400,
      height: 1000,
    });
    expect(uploadGuidance('banner-image', 'home_secondary').ratioLabel).toBe('16:9');
    expect(uploadGuidance('banner-image', 'category').ratioLabel).toBe('6:1');
    expect(uploadGuidance('banner-mobile-image').ratioLabel).toBe('9:4');
    expect(uploadGuidance('media').ratioLabel).toBeNull();
  });

  it('asks for the campaign banner’s own 12:5 frame', () => {
    expect(CAMPAIGN_BANNER_GUIDANCE.ratioLabel).toBe('12:5');
    expect(CAMPAIGN_BANNER_GUIDANCE.recommended).toEqual({ width: 1200, height: 500 });
    expect(guidanceLine(CAMPAIGN_BANNER_GUIDANCE)).toBe(
      'Recommended 1200 × 500 px (12:5) · JPEG, PNG or WebP · up to 5 MB · at least 400 px on the shorter side',
    );
  });

  it('asks for a zone picture in the compact 3:1 frame both platforms draw', () => {
    expect(ZONE_BANNER_GUIDANCE.ratioLabel).toBe('3:1');
    expect(ZONE_BANNER_GUIDANCE.recommended).toEqual({ width: 1200, height: 400 });
    expect(guidanceLine(ZONE_BANNER_GUIDANCE)).toContain('Recommended 1200 × 400 px (3:1)');
  });

  it('states the API limits, with the smaller minimum for avatars', () => {
    expect(guidanceLine(uploadGuidance('avatar'))).toContain('at least 128 px');
    expect(guidanceLine(uploadGuidance('brand-logo'))).toContain('at least 400 px');
    expect(guidanceLine(uploadGuidance('brand-logo'))).toContain('JPEG, PNG or WebP · up to 5 MB');
  });

  it('every recommended size meets the slot minimum, and the first crop shape matches the ratio', () => {
    const slots = [
      uploadGuidance('product-image'),
      uploadGuidance('brand-logo'),
      uploadGuidance('banner-image', 'home_hero'),
      uploadGuidance('banner-image', 'home_secondary'),
      uploadGuidance('banner-image', 'category'),
      uploadGuidance('banner-mobile-image'),
      uploadGuidance('category-image'),
      uploadGuidance('avatar'),
      CAMPAIGN_BANNER_GUIDANCE,
      ZONE_BANNER_GUIDANCE,
    ];
    for (const slot of slots) {
      const size = slot.recommended;
      expect(size).not.toBeNull();
      if (!size) continue;
      expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(slot.minShortSide);
      expect(shapeMismatch(slot, size.width, size.height)).toBeLessThan(0.01);
    }
  });

  it('measures how far a picture is from the slot shape', () => {
    expect(shapeMismatch(uploadGuidance('product-image'), 1000, 1000)).toBe(0);
    expect(shapeMismatch(uploadGuidance('product-image'), 2000, 1000)).toBe(1);
    expect(shapeMismatch(uploadGuidance('media'), 2000, 1000)).toBeNull();
  });
});
