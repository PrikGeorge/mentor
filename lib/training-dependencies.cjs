'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const artifactName = dependency => `${dependency.groupId}.${dependency.artifactId}-${dependency.version}.jar`;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function dependencyPaths(environment,cacheDir) {
  return environment.dependencies.map(dependency => {
    const file=path.join(cacheDir,'jars',artifactName(dependency));
    if(!fs.existsSync(file) || digest(fs.readFileSync(file))!==dependency.sha256) {
      const error=new Error(`Зависимости не подготовлены или повреждены. Выполните node scripts/prepare-training.cjs (профиль ${environment.id}).`);
      error.code='DEPENDENCIES_UNAVAILABLE'; throw error;
    }
    return file;
  });
}
module.exports={artifactName,digest,dependencyPaths};
