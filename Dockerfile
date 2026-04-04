FROM node:18-alpine

# 앱 디렉토리 생성
WORKDIR /usr/src/app

# 앱 의존성 설치
# package.json과 package-lock.json(존재할 경우) 복사
COPY package*.json ./

RUN npm install --production

# 앱 소스 복사
COPY . .

# 프록시 서버 포트 오픈
EXPOSE 3000

# 서버 실행
CMD [ "npm", "start" ]
