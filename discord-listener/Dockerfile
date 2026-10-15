# 使用輕量 Node.js Alpine 映像檔
FROM node:20-alpine

WORKDIR /app

# 複製專案相依性配置
COPY package*.json ./

# 安裝相依套件 (只安裝生產環境套件)
RUN npm install --omit=dev

# 複製程式碼
COPY . .

# 啟動腳本
CMD ["npm", "start"]
