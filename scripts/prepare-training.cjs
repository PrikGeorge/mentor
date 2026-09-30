#!/usr/bin/env node
'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {createCatalog}=require('../lib/training-catalog.cjs');
const {artifactName,digest}=require('../lib/training-dependencies.cjs');

async function prepareTraining({catalog=createCatalog(),cacheDir=path.join(__dirname,'../.runtime/training-cache'),profileId}={}) {
  const profiles=catalog.environments().filter(profile => !profileId || profile.id===profileId);
  if(!profiles.length) throw new Error('Неизвестный профиль окружения.');
  const prepared=[];
  await fs.mkdir(path.join(cacheDir,'jars'),{recursive:true});
  for(const publicProfile of profiles) {
    const profile=catalog.environment(publicProfile.id);
    for(const dependency of profile.dependencies) {
      const filename=artifactName(dependency), destination=path.join(cacheDir,'jars',filename);
      let bytes; try { bytes=await fs.readFile(destination); } catch(error) { if(error.code!=='ENOENT') throw error; }
      if(!bytes || digest(bytes)!==dependency.sha256) {
        const coordinatePath=`${dependency.groupId.replaceAll('.','/')}/${dependency.artifactId}/${dependency.version}/${dependency.artifactId}-${dependency.version}.jar`;
        const response=await fetch(`https://repo.maven.apache.org/maven2/${coordinatePath}`,{redirect:'error',signal:AbortSignal.timeout(30000)});
        if(!response.ok) throw new Error(`Maven Central: HTTP ${response.status} для ${filename}.`);
        const chunks=[]; let size=0;
        for await(const chunk of response.body) { size+=chunk.length; if(size>32*1024*1024) throw new Error('Артефакт превышает 32 МиБ.'); chunks.push(chunk); }
        bytes=Buffer.concat(chunks);
        if(digest(bytes)!==dependency.sha256) throw new Error(`SHA-256 не совпадает: ${filename}. Кеш не изменён.`);
        const temp=destination+`.${process.pid}.tmp`; await fs.writeFile(temp,bytes); await fs.rename(temp,destination);
      }
      prepared.push({profile:profile.id,file:filename,sha256:dependency.sha256});
    }
  }
  await fs.writeFile(path.join(cacheDir,'dependencies.json'),JSON.stringify({preparedAt:new Date().toISOString(),artifacts:prepared},null,2)+'\n');
  return {cacheDir,artifacts:prepared.length};
}
if(require.main===module) {
  const args=process.argv.slice(2); let cacheDir,profileId;
  for(let index=0;index<args.length;index++) {
    if(args[index]==='--cache-dir' && args[index+1]) cacheDir=path.resolve(args[++index]);
    else if(args[index]==='--profile' && args[index+1]) profileId=args[++index];
    else { console.error('Использование: node scripts/prepare-training.cjs [--cache-dir PATH] [--profile ID]'); process.exit(1); }
  }
  prepareTraining({cacheDir,profileId}).then(result => console.log(`Подготовлено артефактов: ${result.artifacts}. Кеш: ${result.cacheDir}`)).catch(error => {console.error(error.message);process.exitCode=1;});
}
module.exports={prepareTraining};
