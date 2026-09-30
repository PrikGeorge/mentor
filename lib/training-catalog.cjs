'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_LIMIT = 128 * 1024;
const TOTAL_SOURCE_LIMIT = 256 * 1024;
const MAX_SOURCE_FILES = 16;
const safeJavaPath = value => typeof value === 'string' && /^(?:[A-Za-z_$][\w$]*\/)*[A-Za-z_$][\w$]*\.java$/.test(value);
const clone = value => structuredClone(value);

function validateSourceFiles(exercise, files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Передайте объявленные Java-файлы решения.');
  const names = Object.keys(files), allowed = Object.keys(exercise.starterFiles);
  if (!names.length || names.length > MAX_SOURCE_FILES || names.length !== allowed.length || names.some(name => !safeJavaPath(name) || !allowed.includes(name))) {
    throw new Error('Разрешены только все Java-файлы, объявленные преподавателем.');
  }
  let bytes = 0;
  for (const name of names) {
    if (typeof files[name] !== 'string') throw new Error('Код Java-файла должен быть строкой.');
    const size = Buffer.byteLength(files[name], 'utf8');
    if (size > SOURCE_LIMIT) throw new Error('Java-файл превышает 128 КиБ.');
    bytes += size;
  }
  if (bytes > TOTAL_SOURCE_LIMIT) throw new Error('Суммарный размер кода превышает 256 КиБ.');
  return files;
}

function createCatalog({root = path.join(__dirname, '..', 'training')} = {}) {
  root = path.resolve(root);
  const readJson = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, ''));
  const profiles = readJson('environments.json');
  const environments = new Map();
  for (const profile of profiles) {
    if (!/^[a-z0-9-]+$/.test(profile.id) || environments.has(profile.id) || profile.javaVersion !== 21 || !Array.isArray(profile.dependencies)) throw new Error('Некорректное окружение Java.');
    for (const dependency of profile.dependencies) {
      if (!['groupId','artifactId','version'].every(key => /^[a-zA-Z0-9_.-]+$/.test(dependency[key])) || !/^[a-f0-9]{64}$/.test(dependency.sha256)) throw new Error('Зависимость должна иметь фиксированные Maven-координаты и SHA-256.');
    }
    // Annotation processors are trusted teacher configuration, never student source.
    if (!Array.isArray(profile.annotationProcessors) || profile.annotationProcessors.some(value => !/^[\w$]+(?:\.[\w$]+)*$/.test(value))) throw new Error('Некорректный список annotation processors.');
    if (typeof profile.dockerImage !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]*$/.test(profile.dockerImage)) throw new Error('Не указан образ JDK.');
    environments.set(profile.id, profile);
  }
  const records = new Map();
  for (const raw of readJson('catalog.json')) {
    if (!/^[a-z0-9-]+$/.test(raw.id) || records.has(raw.id) || !Number.isSafeInteger(raw.revision) || raw.revision < 1 || !environments.has(raw.environmentId)) throw new Error('Некорректное упражнение.');
    if (!Array.isArray(raw.starterFiles) || raw.starterFiles.some(name => !safeJavaPath(name)) || new Set(raw.starterFiles).size !== raw.starterFiles.length) throw new Error('Некорректные имена исходных файлов.');
    if (!/^[\w$]+(?:\.[\w$]+)*$/.test(raw.className) || !/^[\w$]+$/.test(raw.method) || !Array.isArray(raw.parameterTypes)) throw new Error('Не указан проверяемый метод.');
    if (!Array.isArray(raw.tests) || !raw.tests.length || raw.tests.length > 100 || !raw.tests.some(item => item.sample) || raw.tests.some(item => typeof item.name !== 'string' || !Array.isArray(item.args) || !Object.hasOwn(item, 'expected'))) throw new Error('Упражнению нужны примеры и доверенные проверки.');
    const starterFiles = Object.fromEntries(raw.starterFiles.map(name => [name, fs.readFileSync(path.join(root, 'exercises', raw.id, name), 'utf8')]));
    const record = {...raw, starterFiles};
    validateSourceFiles(record, starterFiles);
    records.set(raw.id, record);
  }
  const publicEnvironment = profile => ({id:profile.id, title:profile.title, javaVersion:profile.javaVersion, dependencies:profile.dependencies.map(item => `${item.groupId}:${item.artifactId}:${item.version}`)});
  return {
    list: () => [...records.values()].map(clone),
    get: id => records.has(id) ? clone(records.get(id)) : null,
    environments: () => [...environments.values()].map(publicEnvironment),
    environment: id => environments.has(id) ? clone(environments.get(id)) : null,
    publicExercise(exercise) {
      return {id:exercise.id,revision:exercise.revision,title:exercise.title,statement:exercise.statement,environment:publicEnvironment(environments.get(exercise.environmentId)),starterFiles:clone(exercise.starterFiles)};
    }
  };
}

module.exports = {createCatalog, validateSourceFiles, SOURCE_LIMIT, TOTAL_SOURCE_LIMIT, MAX_SOURCE_FILES};
