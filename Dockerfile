########################################################################################
# builder image                                                                        #
########################################################################################

FROM python:3.8-slim-bullseye AS builder

# Set the working directory to /app
WORKDIR /app
ARG DEBIAN_FRONTEND=noninteractive

ARG TARGETPLATFORM
ARG BUILDPLATFORM
RUN echo "I am running on $BUILDPLATFORM, building for $TARGETPLATFORM"

ARG CRYPTOGRAPHY_DONT_BUILD_RUST=1

RUN ln -s /usr/bin/dpkg-split /usr/sbin/dpkg-split && \
    ln -s /usr/bin/dpkg-deb /usr/sbin/dpkg-deb && \
    ln -s /bin/tar /usr/sbin/tar && \
    ln -s /bin/rm /usr/sbin/rm

RUN apt-get update \
    && apt-get install -y \
        apt-utils \
        gcc \
        g++ \
        build-essential libssl-dev libffi-dev \
        git swig libpulse-dev libasound2-dev  \
        libsphinxbase3 libsphinxbase-dev \
        libpocketsphinx-dev libavdevice-dev \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install -U pip

ARG SUBSYNC_VERSION=0.17
RUN git clone https://github.com/sc0ty/subsync.git && \
    cd subsync && \
    git checkout $SUBSYNC_VERSION && \
    cp subsync/config.py.template subsync/config.py

# Install any needed packages specified in requirements.txt; build subsync
RUN pip install -r subsync/requirements.txt && \
    pip install pyinstaller && \
    pip install ./subsync

# make sure we have PyInstaller bootloaders for 32bit ARM
RUN if [ "$TARGETPLATFORM" = "linux/arm/v7" ] ; then \
    git clone https://github.com/pyinstaller/pyinstaller && \
    cd pyinstaller/bootloader && \
    python ./waf distclean all ; fi
RUN if [ "$TARGETPLATFORM" = "linux/arm/v7" ] ; then \
    cp -r /app/pyinstaller/PyInstaller/bootloader/Linux-32bit-unknown \
          /usr/local/lib/python3.8/site-packages/PyInstaller/bootloader && \
    cp -r /usr/local/lib/python3.8/site-packages/PyInstaller/bootloader/Linux-32bit-unknown \
          /usr/local/lib/python3.8/site-packages/PyInstaller/bootloader/Linux-32bit-arm ; fi

WORKDIR /app/subsync

# if anything major changes, we'll use our own spec; for now dynamically generate it
#COPY subsync.spec .
RUN pyinstaller bin/subsync && pyinstaller -y subsync.spec

########################################################################################
# actual image                                                                         #
########################################################################################

FROM python:3.8-slim-bullseye
RUN apt-get update && apt-get install -y libdrm-dev libxcb1-dev libgl-dev nodejs && \
    rm -rf /var/lib/apt/lists/*

# add subsync
COPY --from=builder /app/subsync/dist/subsync /app
COPY --from=builder /app/subsync/subsync/key.pub /app
COPY --from=builder /app/subsync/subsync/key.pub /app/_internal
RUN ln -s /app/subsync /usr/bin/subsync

# install non-def deps
COPY subagent /app/subagent


ENTRYPOINT ["node", "/app/subagent"]
