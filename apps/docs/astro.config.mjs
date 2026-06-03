// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import fs from 'node:fs';
import path from 'node:path';

const sidebarFilePath = path.resolve('./src/api-sidebar.json');
const apiSidebarItems = fs.existsSync(sidebarFilePath)
  ? JSON.parse(fs.readFileSync(sidebarFilePath, 'utf-8'))
  : [];

// https://astro.build/config
export default defineConfig({
    site: 'https://noinkin.github.io',
    base: '/strepl',
	integrations: [
		starlight({
			title: 'strepl',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/noinkin/strepl' }],
			sidebar: [
				{
					label: 'Guides',
					items: [
						{ label: 'Getting Started', slug: 'guides/getting-started' },
                        { label: 'Advanced Commands', slug: 'guides/advanced/commands' },
                        { label: 'Middleware', slug: 'guides/advanced/middleware' },
                        { label: 'Options', slug: 'guides/advanced/options' },
					],
				},
				{
					label: 'API Reference',
					items: [
                        { label: 'Overview', slug: 'api' },
                        ...apiSidebarItems
                    ]
				},
			],
		}),
	],
});
 