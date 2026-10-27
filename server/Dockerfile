FROM node:20-alpine

# 仅安装生产依赖：pg 是唯一外部依赖
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts
COPY db ./db

# 上传目录（对象存储落盘位置，建议生产用卷挂载）
RUN mkdir -p /app/data/uploads

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["node", "src/main.js"]
