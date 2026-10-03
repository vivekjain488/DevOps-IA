pipeline {
  agent any
  triggers { githubPush() }
  options { disableConcurrentBuilds() }
  environment { APP_VERSION = "1.0.${BUILD_NUMBER}" }
  stages {
    stage('Checkout') { steps { checkout scm } }
    stage('Install Dependencies') { steps { dir('client') { sh 'npm ci' }; dir('server') { sh 'npm ci' } } }
    // API, worker and processor tests run before any image is built; a failure stops the deploy.
    stage('Run Tests') { steps { dir('server') { sh 'npm test' }; dir('client') { sh 'npm run build' } } }
    stage('Build Docker Images') { steps { sh 'docker compose build api worker metrics-agent' } }
    stage('Deploy') { steps { withCredentials([string(credentialsId: 'splunk-hec-token', variable: 'SPLUNK_HEC_TOKEN'), string(credentialsId: 'splunk-metrics-hec-token', variable: 'SPLUNK_METRICS_HEC_TOKEN')]) { sh '''set +x
          printf "SPLUNK_HEC_TOKEN=%s\\nSPLUNK_METRICS_HEC_TOKEN=%s\\nAPP_VERSION=%s\\n" "$SPLUNK_HEC_TOKEN" "$SPLUNK_METRICS_HEC_TOKEN" "$APP_VERSION" > .env
          docker compose up -d --remove-orphans
        ''' } } }
    stage('Verify Deployment') { steps { sh '''
      for i in $(seq 1 30); do
        if curl -fsS http://localhost:3000/api/health | grep -q '"worker":{"status":"online"'; then echo "API and worker are healthy"; exit 0; fi
        sleep 2
      done
      echo "API or worker did not become healthy"; docker compose ps; exit 1
    ''' } }
    // Push a real file through API -> worker so the deploy is proven end to end, not just "container started".
    stage('Smoke Test') { steps { sh '''
      printf 'name,roll_no\\nsmoke,1\\n' > smoke.csv
      JOB=$(curl -fsS -F file=@smoke.csv http://localhost:3000/api/jobs | sed -n 's/.*"jobId":"\\(JOB-[0-9]*\\)".*/\\1/p')
      echo "Submitted $JOB"
      for i in $(seq 1 20); do
        STATUS=$(curl -fsS http://localhost:3000/api/jobs/$JOB | sed -n 's/.*"status":"\\([A-Z]*\\)".*/\\1/p')
        if [ "$STATUS" = "COMPLETED" ]; then echo "$JOB completed"; exit 0; fi
        if [ "$STATUS" = "FAILED" ]; then echo "$JOB failed"; exit 1; fi
        sleep 1
      done
      echo "$JOB did not finish in time"; exit 1
    ''' } }
  }
  post { always { sh 'rm -f .env smoke.csv' } }
}
