import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HomePage from './page';

describe('HomePage', () => {
  it('shows the platform name, tagline and a single main heading', () => {
    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain('Constitution Intelligence');
    expect(html).toContain('Empowering Your Governance, Safeguarding Your Future.');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<main');
  });
});
