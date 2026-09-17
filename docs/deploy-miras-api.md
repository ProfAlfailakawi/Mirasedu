# نشر خدمة `miras-api` — إعدادٌ لمرة واحدة

`/api/**` و`/seb/**` في `firebase.json` تُوجَّهان إلى خدمة Cloud Run اسمها
`miras-api` في `us-central1` على مشروع `meras-320eb`. وورك-فلو الاستضافة ينشر
الواجهة وحدها (`firebase deploy --only hosting:mirasedu`)، فكان كل تعديل في
`server.ts` يُدمج في `main` ولا يصل إلى الخدمة أبدًا.

أثرُ ذلك ليس نظريًا: مسارات البيئة التجريبية (`/api/demo/*`) دُمجت وبقيت تعود
404 على الموقع الحيّ، فيُخفي الزرَّ من الواجهة لأن `/api/demo/config` لا يُجيب.

`.github/workflows/deploy-cloud-run.yml` يغلق هذه الفجوة. ويحتاج مرة واحدة إلى
هوية نشرٍ بلا مفتاح دائم.

## الخطوات — من Google Cloud Shell

```sh
PROJECT=meras-320eb
POOL=github
SA=miras-deployer
REPO=ProfAlfailakawi/Mirasedu

gcloud config set project "$PROJECT"

# ١. حساب خدمة للنشر
gcloud iam service-accounts create "$SA" || true
for ROLE in roles/run.admin \
            roles/cloudbuild.builds.editor \
            roles/artifactregistry.admin \
            roles/storage.admin \
            roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:$SA@$PROJECT.iam.gserviceaccount.com" \
    --role "$ROLE" --condition=None
done

# ٢. اتحاد هوية لـGitHub — مقيَّد بهذا المستودع وحده
gcloud iam workload-identity-pools create "$POOL" --location global || true
gcloud iam workload-identity-pools providers create-oidc github \
  --location global --workload-identity-pool "$POOL" \
  --issuer-uri "https://token.actions.githubusercontent.com" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition "assertion.repository=='$REPO'" || true

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
gcloud iam service-accounts add-iam-policy-binding \
  "$SA@$PROJECT.iam.gserviceaccount.com" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO"

echo "GCP_WORKLOAD_IDENTITY_PROVIDER = projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/providers/github"
echo "GCP_DEPLOY_SERVICE_ACCOUNT     = $SA@$PROJECT.iam.gserviceaccount.com"
```

## ثم في GitHub

Settings → Secrets and variables → Actions → **Variables** (لا Secrets، فهذه
معرّفات لا أسرار):

| المتغيّر | القيمة |
|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | السطر المطبوع أعلاه |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `miras-deployer@meras-320eb.iam.gserviceaccount.com` |

`--attribute-condition` يقصر الاتحاد على هذا المستودع وحده، ولا يُحفظ مفتاح
دائم في GitHub.

## ثابتان يحرسهما الورك-فلو

* **`--max-instances=1` إلزامي.** الخادم يحمل قاعدة البيانات في ذاكرة العملية.
  نسخةٌ ثانية تعني حالتين منفصلتين وكتاباتٍ ضائعة. يُمرَّر عند النشر ويُتحقَّق
  منه بعده، فيفشل الورك-فلو إن تغيّر بأي طريق.
* **`MIRAS_SESSION_SECRET` إلزامي.** الحاوية ترفض الإقلاع بدونه. والورك-فلو لا
  يمرّر `--set-secrets` عمدًا حتى لا يمحو ما هو مضبوط على الخدمة، ويتحقّق بعد
  النشر أنه ما زال موجودًا.

إن لم يكن مضبوطًا بعد:

```sh
gcloud run services update miras-api --region us-central1 \
  --set-secrets MIRAS_SESSION_SECRET=miras-session-secret:latest
```

## للتجربة قبل الدمج

الورك-فلو يقبل `workflow_dispatch`، فيمكن تشغيله يدويًا من تبويب Actions بعد
ضبط المتغيّرين، ورؤية النتيجة قبل الاعتماد على النشر التلقائي.
