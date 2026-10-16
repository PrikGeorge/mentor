// Same-origin bootstrap for the bundled Monaco AMD worker; no blob or remote script.
self.MonacoEnvironment = {baseUrl: new URL('./', self.location.href).href};
importScripts('vs/base/worker/workerMain.js');
