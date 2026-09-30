ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY TrustedHarness.java ContainerDeadline.java /opt/mentor/source/
RUN mkdir -p /opt/mentor/trusted /opt/mentor/deps && javac -J-Xmx256m -encoding UTF-8 --release 21 -proc:none -d /opt/mentor/trusted /opt/mentor/source/*.java
COPY deps/ /opt/mentor/deps/
COPY runner.policy /opt/mentor/runner.policy
USER 10001:10001
ENTRYPOINT ["java","-Xmx16m","-XX:ActiveProcessorCount=1","-cp","/opt/mentor/trusted","mentor.runner.ContainerDeadline"]
