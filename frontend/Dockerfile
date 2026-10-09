FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
ARG VITE_BACKEND_URL=/backend
ARG VITE_BASE_DOMAIN=medipulse.live
ARG VITE_APP_DOMAINS=localhost,127.0.0.1
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_BASE_DOMAIN=$VITE_BASE_DOMAIN
ENV VITE_APP_DOMAINS=$VITE_APP_DOMAINS
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
