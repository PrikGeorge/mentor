# Isolated practice worker

Run the worker on the Docker host, separately from the web backend. Public deployments require a separate VM. The backend must never receive the Docker socket. Worker credentials are rotating files read on each request; they are never logged, copied into images, or mounted into sandboxes.

Prepare the operator-approved Java 21 base image and SHA-256-verified dependency cache, then run `infra/runner/build-environments.ps1`. This builds immutable dependency images offline, copying the existing trusted harness with its original attribution. Keep the generated manifest outside Git. Jobs must match its exact environment ID, revision and image digest; a job cannot choose a command, dependency URL, tag, or resource increase. Rebuild the manifest explicitly when approving a new environment.

Start with:

```
java -jar runner/target/runner-0.1.0-SNAPSHOT.jar --service https://private-platform/internal/v1/ --credential /private/worker-token --manifest /private/environments.json --worker worker-1
```

The generated transport DTOs live in `runner/target/generated-sources/openapi` and have no backend domain dependency. Exercise revisions retain their JSON number/string distinction.

The worker uses one execution slot. It renews a 30-second lease every five seconds and stops on ownership loss or uncertainty. Sandbox PID 1 independently terminates at the absolute job deadline, capped at 90 seconds. Startup removes expired labelled containers and abandoned containers bearing this worker's stable ID. Use a unique stable ID per worker instance. Temporary mounts contain only that attempt's allowlisted source files; the network is disabled and the root filesystem is read-only. Java policy additionally separates trusted checker permissions from student classes and dependencies.

On POSIX hosts, each attempt has an owner-private `0700` temporary parent. Only its inner source subtree is mounted read-only: directories are explicitly `0755` and files `0644`, so sandbox UID 10001 can read them even when the host worker has another UID or uses `umask 077`. Unrelated host users cannot traverse the private parent. The entire parent is removed after execution; no host credential or other file is included in the mounted subtree.

Run the mandatory real-Docker lane with `mvnw -pl runner test`. Docker absence is a failure. Tests use synthetic files and a synthetic internal HTTP job service; queue integration is covered separately by Task 15.

`SourceStagingTest` exercises the production staging code on a native Linux Docker volume under `umask 077`, even on Windows test hosts. It proves that UID 10001 can compile nested packages from the read-only mounted subtree while unrelated UID 10002 cannot read sources through the host parent. Also run `ContainerExecutionTest,SourceStagingTest` on a native Linux JVM whose UID differs from 10001 to exercise the complete executor's actual bind mount.
