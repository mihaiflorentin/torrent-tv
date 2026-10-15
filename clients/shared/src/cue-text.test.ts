import { describe, expect, it } from 'vitest';
import { cueDisplayText } from '@torrent-tv/shared';

describe('cueDisplayText', () => {
  it('turns every <br> spelling into a real line break', () => {
    expect(cueDisplayText('Line1</br>Line2')).toBe('Line1\nLine2');
    expect(cueDisplayText('Line1<br>Line2')).toBe('Line1\nLine2');
    expect(cueDisplayText('Line1<br/>Line2')).toBe('Line1\nLine2');
    expect(cueDisplayText('Line1<BR />Line2')).toBe('Line1\nLine2');
    expect(cueDisplayText('Line1&lt;br&gt;Line2')).toBe('Line1\nLine2');
    expect(cueDisplayText('Line1&lt;/br&gt;Line2')).toBe('Line1\nLine2');
  });
  it('handles ASS override blocks and literal \\N breaks', () => {
    expect(cueDisplayText('{\\an8}Top\\NBottom')).toBe('Top\nBottom');
    expect(cueDisplayText('{\\i1}Hi{\\i0}\\Nthere')).toBe('Hi\nthere');
  });
  it('keeps plain braces and lowercase \\n as dialogue', () => {
    expect(cueDisplayText('He typed {admin} then C:\\new')).toBe('He typed {admin} then C:\\new');
    expect(cueDisplayText('{music}')).toBe('{music}');
  });
  it('strips safe formatting tags and decodes entities as text', () => {
    expect(cueDisplayText('<i>Hello</i> <b>there</b> <font color="#fff">you</font> <u>x</u>')).toBe('Hello there you x');
    expect(cueDisplayText('Tom &amp; Jerry &lt;3 &nbsp;ok')).toBe('Tom & Jerry <3  ok');
    expect(cueDisplayText('<c.yellow><00:00:01.000>word</c>')).toBe('word');
  });
  it('drops empty lines and trailing whitespace', () => {
    expect(cueDisplayText(' a </br>\n</br> b ')).toBe('a\nb');
    expect(cueDisplayText('')).toBe('');
  });
  it('keeps text that merely contains angle brackets in prose', () => {
    expect(cueDisplayText('1 < 2 and 3 > 2')).toBe('1 < 2 and 3 > 2');
  });
});
