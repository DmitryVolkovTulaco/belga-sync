FROM node:12 AS build
RUN apt-get update \
    && rm -rf /var/lib/apt/lists/*
COPY ./ /source
WORKDIR /source
RUN npm ci
RUN npm run build

FROM build AS dist
COPY --from=build /source /source
