FROM docker:28.5.2-cli@sha256:625d9431a9f54c5a2bc90f24f0e1c3d55b1349fd857dd85035f98c2c9acbdd4d AS docker_cli
FROM eclipse-temurin:21-jre-jammy@sha256:e9aaf73145bbd1f9f6ec7f6867dd75a44f34b1a6c32a813504bf4129be2d09d7
COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker
RUN groupadd --gid 10001 mentor && useradd --uid 10001 --gid mentor --no-create-home --shell /usr/sbin/nologin mentor
WORKDIR /opt/mentor
COPY --chown=10001:10001 runner/target/runner-0.1.0-SNAPSHOT.jar /opt/mentor/runner.jar
USER 10001:10001
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=60", "-jar", "/opt/mentor/runner.jar"]
