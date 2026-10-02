pipeline {
  agent any
  triggers { githubPush() }
  environment { APP_VERSION = "1.0.${BUILD_NUMBER}" }
  stages {
    stage('Checkout') { steps { checkout scm } }
    stage('Install Dependencies') { steps { dir('client') { sh 'npm ci' }; dir('server') { sh 'npm ci' } } }
    stage('Run Tests') { steps { dir('server') { sh 'npm test' } } }
    stage('Build Docker Images') { steps { sh 'docker compose build' } }
    stage('Deploy') { steps { withCredentials([string(credentialsId: 'splunk-hec-token', variable: 'SPLUNK_HEC_TOKEN'), string(credentialsId: 'splunk-metrics-hec-token', variable: 'SPLUNK_METRICS_HEC_TOKEN')]) { sh '''set +x
          printf "SPLUNK_HEC_TOKEN=%s\\nSPLUNK_METRICS_HEC_TOKEN=%s\\nAPP_VERSION=%s\\n" "$SPLUNK_HEC_TOKEN" "$SPLUNK_METRICS_HEC_TOKEN" "$APP_VERSION" > .env
          docker compose up -d --remove-orphans
        ''' } } }
    stage('Verify Deployment') { steps { sh 'for i in $(seq 1 30); do curl -fsS http://localhost:3000/api/health && exit 0; sleep 2; done; exit 1' } }
  }
  post { always { sh 'rm -f .env' } }
}
