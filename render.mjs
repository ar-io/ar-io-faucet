/**
 * AR.IO Gateway
 * Copyright (C) 2022-2023 Permanent Data Solutions, Inc. All Rights Reserved.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import ejs from 'ejs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

/* eslint-disable no-undef */
const captchaSiteKey = process.env.CAPTCHA_SITE_KEY;
const baseUrl = 'https://faucet.ario.permaweb.services';
export async function renderTemplate(templateName, data) {
	const templatePath = join(
		process.cwd(),
		'src',
		'public',
		`${templateName}.ejs`,
	);
	const template = await readFile(templatePath, 'utf-8');
	return ejs.render(template, data);
}

for (const templateName of ['index']) {
	// render the template
	const html = await renderTemplate(templateName, {
		captchaSiteKey,
		baseUrl,
	});
	// mkdir public if not exists
	await mkdir(join(process.cwd(), 'public'), { recursive: true });
	// write the rendered template to the public directory
	await writeFile(join(process.cwd(), 'public', `${templateName}.html`), html);
}
