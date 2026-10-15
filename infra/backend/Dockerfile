# syntax=docker/dockerfile:1
# Two ways to obtain the executable JAR; the runtime stage is identical for both (INF-12):
#   JAR_SOURCE=build    (default) compile inside the image with the pinned Maven/JDK 21 image. No Windows host
#                       toolchain, no CRLF or FAT32 surprises; this is what CI and the Linux VPS use.
#   JAR_SOURCE=prebuilt copy backend/target/backend-*.jar produced by `./mvnw.cmd -pl backend verify` on the
#                       host (the established release procedure). Exactly one JAR must be present.
# BuildKit is required (it already was: infra/backend/Dockerfile.dockerignore is a per-Dockerfile ignore file);
# only the stage selected by JAR_SOURCE is executed.
ARG JAR_SOURCE=build

FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS build
WORKDIR /workspace
# Same Maven version as .mvn/wrapper/maven-wrapper.properties, so `mvn` here equals `./mvnw` without the
# wrapper download (which would need network access and unzip in the build container).
# The root POM lists both modules, so Maven needs runner/pom.xml to assemble the reactor even for -pl backend.
COPY pom.xml ./
COPY backend/pom.xml backend/
COPY runner/pom.xml runner/
COPY backend/src backend/src
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp -pl backend -DskipTests package \
    && mkdir -p /out && cp backend/target/backend-*.jar /out/app.jar

FROM scratch AS prebuilt
# A glob keeps the Maven version out of this file; the destination name is fixed for the runtime stage.
COPY backend/target/backend-*.jar /out/app.jar

FROM ${JAR_SOURCE} AS jar

FROM eclipse-temurin:21-jre-jammy@sha256:f04fb34e053148344e83317976114ec3f37e4b830ec8bdab5a2fe3cecd7d010b
RUN groupadd --gid 10001 mentor && useradd --uid 10001 --gid mentor --no-create-home --shell /usr/sbin/nologin mentor \
    && mkdir -p /var/lib/mentor/objects /var/lib/mentor/spool && chown -R mentor:mentor /var/lib/mentor
WORKDIR /opt/mentor
COPY --from=jar --chown=10001:10001 /out/app.jar /opt/mentor/app.jar
USER 10001:10001
EXPOSE 8081
# Heap sizing is an environment default (overridable per deployment) instead of a fixed ENTRYPOINT flag:
# MaxRAMPercentage is relative to the cgroup memory limit, so it must be paired with a Compose limit.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70 -XX:+ExitOnOutOfMemoryError"
ENTRYPOINT ["java", "-jar", "/opt/mentor/app.jar"]
