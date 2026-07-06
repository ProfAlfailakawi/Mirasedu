# صورة خادم مِراس على Cloud Run مع LibreOffice — لازمة لتحويل ملفات أوفيس
# (ppt/pptx/doc/docx/rtf) إلى PDF عبر الأمر soffice داخل server.ts. صورة Node
# العادية لا تحتوي LibreOffice، فيفشل التحويل؛ هذا الـ Dockerfile يضيفه + خطوطاً.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-impress \
      libreoffice-writer \
      libreoffice-calc \
      fonts-liberation \
      fonts-dejavu-core \
      fonts-noto-core \
      fonts-kacst \
      fonts-sil-scheherazade \
      fonts-hosny-amiri \
      python3-uno \
      python3-pip \
    && rm -rf /var/lib/apt/lists/*

# unoserver يبقي LibreOffice قيد التشغيل دائماً فيصبح تحويل المستندات ~١ث بدل ~٥ث.
RUN pip3 install --no-cache-dir --break-system-packages unoserver

# الخطوط العربية الفعلية المستخدمة في عروض الطلبة والتطبيق (Cairo وTajawal وAmiri)
# حتى تُرسَم الشرائح بخطها الصحيح تماماً بدل بديل تقريبي عند التحويل إلى PDF.
COPY fonts/ /usr/share/fonts/truetype/miras-arabic/
RUN fc-cache -f

# نظام ملفات Cloud Run للقراءة فقط عدا /tmp، فنوجّه HOME وملف LibreOffice إليه.
ENV HOME=/tmp

WORKDIR /app
COPY package*.json ./
# NODE_ENV غير مضبوط هنا حتى يثبّت npm ci حزم التطوير (vite/esbuild) اللازمة للبناء.
RUN npm ci
COPY . .
# ملف تهيئة Firestore الذي يحقنه بايبلاين AI Studio عند النشر؛ في المصدر الخام
# يكون فارغاً (0 بايت) فيفشل JSON.parse وتبقى Firestore غير مُهيّأة → كل عملية
# كتابة (تسجيل الدخول…) ترجّع 503. نولّده هنا بنفس قيم الإنتاج (00028) حتى تُهيّأ
# قاعدة البيانات داخل هذه الصورة. (projectId عام و firestoreDatabaseId اسم قاعدة.)
RUN printf '{"projectId":"meras-320eb","firestoreDatabaseId":"miras-production-v2"}' > firebase-applet-config.json
RUN npm run build

# وضع الإنتاج: يخدم dist/ الثابتة ولا يشغّل Vite dev middleware (يُضبط بعد البناء
# حتى لا يتخطّى npm ci حزم التطوير). Cloud Run يضبط PORT تلقائياً.
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/server.cjs"]
