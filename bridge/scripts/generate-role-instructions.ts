import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generatedRoleFiles, repositoryRoot } from './instruction-catalog.ts';
for (const [path, text] of Object.entries(generatedRoleFiles())) writeFileSync(resolve(repositoryRoot,path),text);
console.log('ROLE_INSTRUCTIONS_GENERATED');
