// ⚠️ روابط الموقع القديم معطّلة مؤقتاً.
// عند بناء الصفحات الداخلية، غيّر LINK_OUT إلى true.
export const LINK_OUT = false

/** صوت المتصفّح الآلي رديء للعربية. اجعله true فقط إن لم تولّد ملفات MP3. */
export const ALLOW_BROWSER_TTS = false

/** المرآة الإنجليزية تُبنى بهدوء: صفحاتها حية على /en لكن زرّها مخفي وخارج الفهرسة.
    عند بناء الموقع كاملاً بالإنجليزية لاحقاً: اجعله true — يظهر الزر وتعود الفهرسة. */
export const SHOW_EN_TOGGLE = false

// نصوص المقالات الكاملة — تُملأ بتشغيل: npm run import
import bodies from './data/bodies.json'

export const profile = {
  name: 'أحمد حسين الفيلكاوي',
  fullName: 'أحمد حسين الفيلكاوي',
  eyebrow: 'أستاذ تكنولوجيا التعليم والذكاء الاصطناعي',
  tagline: 'أستاذ تكنولوجيا التعليم والذكاء الاصطناعي · مؤلف · باحث · مستشار',
  aboutHeading: 'أُبقي الإنسان\nفي قلب الآلة.',
  about:
    'حاصل على درجة دكتوراه الفلسفة في التربية، تخصص تكنولوجيا التعليم من جامعة شمال كولورادو. أستاذ مشارك في كلية التربية الأساسية (PAAET) وأستاذ منتدب في كلية التربية بجامعة الكويت. خبير ومستشار في وزارة الإعلام والمجلس الوطني للثقافة والفنون والآداب ومكتبة الكويت الوطنية والهيئة العامة للشباب.',
  facts: [
    'دكتوراه — جامعة شمال كولورادو',
    'PAAET · جامعة الكويت',
    '9 كتب منشورة',
    '18 بحثاً محكّماً',
    'كاتب في جريدة الجريدة',
    'مستشار — وزارة الإعلام',
    'أستاذ مشارك منذ 2020',
  ],
}


export const books = [
  { slug: 'encyclopedia', title: 'موسوعة تكنولوجيا التعليم', isbn: '978-99966-1-281-7',
    cover: '/covers/encyclopedia.png',
    pdf: '/files/encyclopedia.pdf',
    desc: 'عمل مرجعي شامل في تكنولوجيا التعليم — كتاب ورقي تفاعلي.' },
  { slug: 'teaching', title: 'مناهج وطرق التدريس (تكنولوجيا التعليم)', isbn: '978-9921-0-2023-6',
    cover: '/covers/teaching.png',
    pdf: '/files/teaching.pdf',
    desc: 'مناهج وطرق التدريس الحديثة في ضوء تكنولوجيا التعليم.' },
  { slug: 'mega-data', title: 'حوكمة الذكاء الاصطناعي والبيانات الضخمة', isbn: '978-9921-0-2013-7',
    cover: '/covers/mega-data.png',
    pdf: '/files/mega-data.pdf',
    desc: 'حوكمة الذكاء الاصطناعي وإدارة البيانات الضخمة في التعليم.' },
  { slug: 'handy-tech', title: 'تكنولوجيا ذوي الاحتياجات الخاصة', isbn: '978-9921-0-2015-1',
    cover: '/covers/handy-tech.png',
    pdf: '/files/handy-tech.pdf',
    desc: 'التقنيات المساعِدة وإتاحة التعليم لذوي الاحتياجات الخاصة.' },
  { slug: 'smart-school', title: 'المدارس الذكية', isbn: '978-9921-0-2022-9',
    cover: '/covers/smart-school.png',
    pdf: '/files/smart-school.pdf',
    desc: 'نماذج المدارس الذكية وبيئاتها الرقمية.' },
  { slug: 'virtual-world', title: 'العالم الافتراضي', isbn: '978-9921-0-2020-5',
    cover: '/covers/virtual-world.png',
    pdf: '/files/virtual-world.pdf',
    desc: 'الواقع الافتراضي وبيئاته التعليمية.' },
  { slug: 'kids-tech', title: 'الطفل والتكنولوجيا', isbn: '978-9921-0-2021-2',
    cover: '/covers/kids-tech.png',
    pdf: '/files/kids-tech.pdf',
    desc: 'أثر التكنولوجيا على الطفولة والتعلّم المبكر.' },
  { slug: 'gamification', title: 'التلعيب Gamification وعالم الألعاب', isbn: '978-9921-0-2019-9',
    cover: '/covers/gamification.png',
    pdf: '/files/gamification.pdf',
    desc: 'التلعيب والألعاب التعليمية وتوظيفها في التعلّم.' },
  { slug: 'digital-education', title: 'التعليم ومتطلبات العصر.. (التعلم الرقمي)', isbn: '978-9921-0-2018-2',
    cover: '/covers/digital-education.png',
    pdf: '/files/digital-education.pdf',
    desc: 'التعلّم الرقمي ومتطلبات القرن الحادي والعشرين.' },
]

export const papers = [
  { slug: 'ms-teams-development-application-trends-as-a-quality-education-in-light-of-the-epidemiological-challenges-covid-19-in-kuwait-2', title: 'اتجاهات تطبيق Ms Teams كتعليمٍ نوعي في ضوء تحديات جائحة كوفيد-19 في الكويت', meta: 'MS Teams · Quality Education', journal: 'Global Journal of Educational Studies · 8(2) 2022 · ص 144–167', source: 'https://ideas.repec.org/s/mth/gjes88.html', url: 'https://dr-alfailakawi.com/scholarly_contributi/ms-teams-development-application-trends-as-a-quality-education-in-light-of-the-epidemiological-challenges-covid-19-in-kuwait-2/' },
  { slug: 'the-reality-of-using-smart-device-applications-in-learning-applications-by-university-students-at-the-college-of-basic-education-in-kuwait-2', title: 'واقع استخدام تطبيقات الأجهزة الذكية في التعلّم لدى طلبة كلية التربية الأساسية', meta: 'Smart Device Applications', journal: 'Global Journal of Educational Studies · 8(2) 2022 · ص 102–126', source: 'https://ideas.repec.org/a/mth/gjes88/v8y2022i2p102-126.html', url: 'https://dr-alfailakawi.com/scholarly_contributi/the-reality-of-using-smart-device-applications-in-learning-applications-by-university-students-at-the-college-of-basic-education-in-kuwait-2/' },
  { slug: 'trends-of-college-of-basic-education-students-towards-the-use-of-photography-to-develop-learning-skills-in-kuwait-2', title: 'اتجاهات طلبة كلية التربية الأساسية نحو استخدام التصوير لتنمية مهارات التعلّم', meta: 'Photography · Learning Skills', journal: 'Global Journal of Educational Studies · 8(2) 2022 · ص 187–207', source: 'https://ideas.repec.org/s/mth/gjes88.html', url: 'https://dr-alfailakawi.com/scholarly_contributi/trends-of-college-of-basic-education-students-towards-the-use-of-photography-to-develop-learning-skills-in-kuwait-2/' },
  { slug: 'the-importance-of-adopting-learning-management-systems-lms-to-enhance-the-quality-of-teaching-among-university-professors-in-kuwait-2', title: 'أهمية تبنّي أنظمة إدارة التعلّم (LMS) لتعزيز جودة التدريس لدى أساتذة الجامعة', meta: 'LMS · Teaching Quality', url: 'https://dr-alfailakawi.com/scholarly_contributi/the-importance-of-adopting-learning-management-systems-lms-to-enhance-the-quality-of-teaching-among-university-professors-in-kuwait-2/' },
  { slug: 'the-role-of-technological-creative-photography-in-contemporary-education-frameworks-in-developing-the-knowledge-skills-and-abilities-of-university-professors-at-the-college-of-basic-education-in-kuw-2', title: 'دور التصوير الإبداعي التكنولوجي في تنمية معارف ومهارات أساتذة كلية التربية الأساسية', meta: 'Creative Photography · Faculty', url: 'https://dr-alfailakawi.com/scholarly_contributi/the-role-of-technological-creative-photography-in-contemporary-education-frameworks-in-developing-the-knowledge-skills-and-abilities-of-university-professors-at-the-college-of-basic-education-in-kuw-2/' },
  { slug: 'university-students-perceptions-at-the-college-of-basic-education-regarding-the-use-of-interactive-blackboard-technology-in-education-in-kuwait-for-the-academic-year-2020-2021-2', title: 'تصورات طلبة كلية التربية الأساسية نحو استخدام السبّورة التفاعلية 2020/2021', meta: 'Interactive Whiteboard', url: 'https://dr-alfailakawi.com/scholarly_contributi/university-students-perceptions-at-the-college-of-basic-education-regarding-the-use-of-interactive-blackboard-technology-in-education-in-kuwait-for-the-academic-year-2020-2021-2/' },
  { slug: 'perceptions-of-university-students-at-the-college-of-basic-education-toward-implementing-moodle-in-managing-e-courses-to-enhance-learning-in-kuwait-2', title: 'تصورات طلبة كلية التربية الأساسية نحو تطبيق Moodle في إدارة المقررات الإلكترونية', meta: 'Moodle · E-Courses', url: 'https://dr-alfailakawi.com/scholarly_contributi/perceptions-of-university-students-at-the-college-of-basic-education-toward-implementing-moodle-in-managing-e-courses-to-enhance-learning-in-kuwait-2/' },
  { slug: 'the-impact-of-the-working-environment-and-learning-science-in-the-electronic-learning-systems-used-in-education-2', title: 'أثر بيئة العمل وعلوم التعلّم في أنظمة التعلّم الإلكتروني المستخدمة في التعليم', meta: 'Working Environment · Learning Science', url: 'https://dr-alfailakawi.com/scholarly_contributi/the-impact-of-the-working-environment-and-learning-science-in-the-electronic-learning-systems-used-in-education-2/' },
  { slug: 'investigating-the-role-of-e-learning-management-systems-in-the-learning-process-from-the-point-of-view-of-the-faculty-at-the-faculty-of-basic-education-in-kuwait-2', title: 'دور أنظمة إدارة التعلّم الإلكتروني في العملية التعليمية من وجهة نظر هيئة التدريس', meta: 'E-Learning Management Systems', url: 'https://dr-alfailakawi.com/scholarly_contributi/investigating-the-role-of-e-learning-management-systems-in-the-learning-process-from-the-point-of-view-of-the-faculty-at-the-faculty-of-basic-education-in-kuwait-2/' },
  { slug: 'how-important-is-the-use-of-e-learning-management-systems-in-building-a-smart-university-in-kuwait-2', title: 'أهمية أنظمة إدارة التعلّم الإلكتروني في بناء الجامعة الذكية في الكويت', meta: 'Smart University', url: 'https://dr-alfailakawi.com/scholarly_contributi/how-important-is-the-use-of-e-learning-management-systems-in-building-a-smart-university-in-kuwait-2/' },
  { slug: 'the-reality-of-using-cloud-computing-in-university-education-from-the-point-of-view-of-faculty-members-in-kuwait-2', title: 'واقع استخدام الحوسبة السحابية في التعليم الجامعي من وجهة نظر هيئة التدريس', meta: 'Cloud Computing', url: 'https://dr-alfailakawi.com/scholarly_contributi/the-reality-of-using-cloud-computing-in-university-education-from-the-point-of-view-of-faculty-members-in-kuwait-2/' },
  { slug: 'the-availability-of-e-learning-qualifications-among-faculty-members-at-the-faculty-of-basic-education-in-kuwait-2', title: 'مدى توافر كفايات التعلّم الإلكتروني لدى أعضاء هيئة التدريس بكلية التربية الأساسية', meta: 'E-Learning Qualifications', url: 'https://dr-alfailakawi.com/scholarly_contributi/the-availability-of-e-learning-qualifications-among-faculty-members-at-the-faculty-of-basic-education-in-kuwait-2/' },
  { slug: 'obstacles-to-the-employment-of-education-technology-and-means-for-students-with-special-needs-from-the-point-of-view-of-faculty-members-at-the-public-authority-for-applied-2', title: 'معوّقات توظيف تكنولوجيا التعليم لذوي الاحتياجات الخاصة من وجهة نظر هيئة التدريس', meta: 'Ed-Tech · Special Needs', url: 'https://dr-alfailakawi.com/scholarly_contributi/obstacles-to-the-employment-of-education-technology-and-means-for-students-with-special-needs-from-the-point-of-view-of-faculty-members-at-the-public-authority-for-applied-2/' },
  { slug: 'faculty-members-degree-of-awareness-of-augmented-reality-concept-in-the-college-of-basic-education-public-authority-for-applied-education-and-training-in-kuwait-2', title: 'درجة وعي أعضاء هيئة التدريس بمفهوم الواقع المعزّز في كلية التربية الأساسية', meta: 'Augmented Reality Awareness', url: 'https://dr-alfailakawi.com/scholarly_contributi/faculty-members-degree-of-awareness-of-augmented-reality-concept-in-the-college-of-basic-education-public-authority-for-applied-education-and-training-in-kuwait-2/' },
  { slug: 'faculty-attitudes-edtech', title: 'اتجاهات الهيئة التدريسية نحو استخدام تكنولوجيا التعليم في كلية التربية الأساسية', meta: 'Faculty Attitudes · Ed-Tech', url: 'https://dr-alfailakawi.com/scholarly_contributi/%d8%a7%d8%aa%d8%ac%d8%a7%d9%87%d8%a7%d8%aa-%d8%a7%d9%84%d9%87%d9%8a%d8%a6%d8%a9-%d8%a7%d9%84%d8%aa%d8%af%d8%b1%d9%8a%d8%b3%d9%8a%d8%a9-%d9%86%d8%ad%d9%88-%d8%a7%d8%b3%d8%aa%d8%ae%d8%af%d8%a7%d9%85-2/' },
  { slug: 'multimedia-higher-education', title: 'فاعلية استخدام أعضاء هيئة التدريس للوسائط المتعددة في التعليم الجامعي', meta: 'Multimedia in Higher Education', url: 'https://dr-alfailakawi.com/scholarly_contributi/%d9%81%d8%a7%d8%b9%d9%84%d9%8a%d8%a9-%d8%a7%d8%b3%d8%aa%d8%ae%d8%af%d8%a7%d9%85-%d8%a3%d8%b9%d8%b6%d8%a7%d8%a1-%d9%87%d9%8a%d8%a6%d8%a9-%d8%a7%d9%84%d8%aa%d8%af%d8%b1%d9%8a%d8%b3-%d9%84%d9%84%d9%88-2/' },
  { slug: 'web-navigation-learning-skills', title: 'فاعلية الإبحار في المواقع الإلكترونية على تحسين مهارات الطلبة نحو التعلّم', meta: 'Web Navigation · Learning Skills', url: 'https://dr-alfailakawi.com/scholarly_contributi/%d9%81%d8%a7%d8%b9%d9%84%d9%8a%d8%a9-%d8%a7%d9%84%d8%a8%d8%ad%d8%a7%d8%b1-%d9%81%d9%8a-%d8%a7%d9%84%d9%88%d8%a7%d9%82%d8%b9-%d8%a7%d9%84%d9%84%d9%83%d8%aa%d8%b1%d9%88%d9%86%d9%8a%d8%a9-%d8%b9%d9%84-2/' },
  { slug: 'elearning-research-skills', title: 'أهمية التعلّم الإلكتروني في اكتساب مهارات البحث العلمي لدى طلبة البكالوريوس والدراسات العليا', meta: 'E-Learning · Research Skills', url: 'https://dr-alfailakawi.com/scholarly_contributi/%d8%a3%d9%87%d9%85%d9%8a%d8%a9-%d8%a7%d9%84%d8%aa%d8%b9%d9%84%d9%85-%d8%a7%d9%84%d8%a5%d9%84%d9%83%d8%aa%d8%b1%d9%88%d9%86%d9%8a-%d9%81%d9%8a-%d8%a7%d9%83%d8%aa%d8%b3%d8%a7%d8%a8-%d9%85%d9%87%d8%a7-2/' },
]

export const essays = [
  { tag: 'التعليم', title: 'ورقةٌ تتخرّج… والعقل غائب', quote: '«نُتقن فنّ توقيع أسمائنا… وننسى كيف نكتب فكرة.»' },
  { tag: 'مجتمع', title: 'أثرياء الوهم', quote: '«ما نراه بهرجةٌ بلا أساس؛ مسؤوليةُ كلٍّ منّا أن يتحقّق.»' },
  { tag: 'هوية', title: 'جيلٌ بلا جذور', quote: '«الهويةُ الثقافية ليست تفصيلاً تراثياً؛ بل عاملُ حمايةٍ حقيقي.»' },
]


export const socials = [
  { label: 'LinkedIn', url: 'https://www.linkedin.com/in/prof-ahmad-alfailakawi-5922251a5' },
  { label: 'X', url: 'https://twitter.com/drahmadkw' },
  { label: 'Instagram', url: 'https://www.instagram.com/DrAhmadkw/' },
  { label: 'Facebook', url: 'https://www.facebook.com/DrAhmadkw' }, // ⚠️ تأكّد من الرابط الدقيق
  { label: 'YouTube', url: 'https://youtube.com/@drahmadalfailakawi' },
]

export const links = {
  booking: 'http://schedule.dr-alfailakawi.com/',
  cv: '/files/cv.pdf',
}

// المقالات الفكرية الكاملة — مسحوبة من الموقع والأرشيف الصحفي (٢٠١٦ فصاعداً) بتواريخها الحقيقية
export const articles = [
  { slug: 'how-do-we-assess-without-breaking-the-human-beingarabic', title: 'كيف نقيس دون أن نكسر الإنسان', date: '24 أبريل 2026', iso: '2026-04-24', cat: 'التعليم',
    excerpt: 'القياس ضروري، نعم. لكن المشكلة تبدأ حين ننسى أن ما نقيسه هو تعلّمٌ عند إنسان، لا رقمٌ في جدول.',
    url: 'https://dr-alfailakawi.com/signature_articles/how-do-we-assess-without-breaking-the-human-beingarabic/', source: '' },
  { slug: 'success-that-does-not-bring-joy-to-its-ownerarabic', title: 'النجاح الذي لا يفرح صاحبه', date: '17 أبريل 2026', iso: '2026-04-17', cat: 'التعليم',
    excerpt: 'تظهر النتيجة، ترتفع الزغاريد أو تنهال التهاني، ويبتسم الطالب كما ينبغي أن يبتسم… لكن شيئاً في داخله لا يتحرّك.',
    url: 'https://dr-alfailakawi.com/signature_articles/success-that-does-not-bring-joy-to-its-ownerarabic/', source: 'https://www.aljarida.com/article/129142' },
  { slug: 'when-the-exam-becomes-the-goalarabic', title: 'حين يصبح الامتحان هو الهدف', date: '10 أبريل 2026', iso: '2026-04-10', cat: 'التعليم',
    excerpt: 'في ليالي الامتحانات يتغيّر شكل البيت. تخفّ الضحكات، وتعلو الهمسات، ويصبح الوقت فجأةً عدوّاً يركض أسرع من الطالب.',
    url: 'https://dr-alfailakawi.com/signature_articles/when-the-exam-becomes-the-goalarabic/', source: 'https://www.aljarida.com/article/128511' },
  { slug: 'expectations-that-shape-a-studentarabic', title: 'التوقّعات التي تصنع طالباً', date: '3 أبريل 2026', iso: '2026-04-03', cat: 'التعليم',
    excerpt: 'بعض الطلاب لا يسقطون لأنهم عاجزون… بل لأن أحداً أقنعهم، بصمتٍ طويل، أنهم أقلّ مما يمكن أن يكونوا.',
    url: 'https://dr-alfailakawi.com/signature_articles/expectations-that-shape-a-studentarabic/', source: 'https://www.aljarida.com/article/127850' },
  { slug: 'the-classroom-that-fears-mistakesarabic', title: 'الصفُّ الذي يخاف من الخطأ', date: '27 مارس 2026', iso: '2026-03-27', cat: 'التعليم',
    excerpt: 'توقّفنا أسبوعين، وانشغلنا بالحرب، وبالقلق الذي يعلو مع الأخبار، وبالوطن حين يُختبر في سمائه وداخله.',
    url: 'https://dr-alfailakawi.com/signature_articles/the-classroom-that-fears-mistakesarabic/', source: 'https://www.aljarida.com/article/127175' },
  { slug: 'the-homeland-is-not-a-point-of-view-in-times-of-crisisarabic', title: 'الوطن ليس وجهةَ نظرٍ وقتَ الأزمات', date: '13 مارس 2026', iso: '2026-03-13', cat: 'مجتمع',
    excerpt: 'في الأيام العادية، يستطيع كثيرون أن يخلطوا بين الرأي والانتماء، بين التحليل والولاء، بين الحضور في النقاش والحضور في الوطن.',
    url: 'https://dr-alfailakawi.com/signature_articles/the-homeland-is-not-a-point-of-view-in-times-of-crisisarabic/', source: 'https://www.aljarida.com/article/125811' },
  { slug: 'aggression-in-the-sky-and-steadfastness-withinarabic', title: 'العدوان في السماء… والثبات في الداخل', date: '6 مارس 2026', iso: '2026-03-06', cat: 'مجتمع',
    excerpt: 'حين تعلو صفارات الإنذار، لا يرتجف الصوت وحده… ترتجف معه لحظةٌ داخل القلب.',
    url: 'https://dr-alfailakawi.com/signature_articles/aggression-in-the-sky-and-steadfastness-withinarabic/', source: 'https://www.aljarida.com/article/125110' },
  { slug: 'when-the-teacher-knows-why-he-teachesarabic', title: 'حين يعرف المعلّم لماذا يعلّم', date: '27 فبراير 2026', iso: '2026-02-27', cat: 'التعليم',
    excerpt: 'دخل المعلّم الصفّ كعادته. شرح الدرس بإتقان، رتّب الأفكار، أنهى الأهداف المحددة في خطته. لم يكن هناك خطأٌ ظاهر.',
    url: 'https://dr-alfailakawi.com/signature_articles/when-the-teacher-knows-why-he-teachesarabic/', source: 'https://www.aljarida.com/article/124284' },
  { slug: 'children-who-know-what-is-required-but-do-not-know-whyarabic-2', title: 'أبناءٌ يعرفون المطلوب… ويجهلون لماذا', date: '20 فبراير 2026', iso: '2026-02-20', cat: 'التربية',
    excerpt: 'في أحد الصفوف، رفعتُ سؤالاً بسيطاً: لماذا تتعلّم؟ لم يتأخر الجواب: «علشان أنجح.» «علشان أجيب نسبة.»',
    url: 'https://dr-alfailakawi.com/signature_articles/children-who-know-what-is-required-but-do-not-know-whyarabic-2/', source: 'https://www.aljarida.com/article/123774' },
  { slug: 'a-new-kind-of-fatigue-in-old-expressionsarabic', title: 'تعبٌ جديد بعبارات قديمة', date: '13 فبراير 2026', iso: '2026-02-13', cat: 'مجتمع',
    excerpt: 'نقول: «ضغط»، «إرهاق»، «روتين»… كأنها كلماتٌ كافية لشرح ما يحدث لنا. لكن التعب الذي نعيشه اليوم ليس مجرد زيادة.',
    url: 'https://dr-alfailakawi.com/signature_articles/a-new-kind-of-fatigue-in-old-expressionsarabic/', source: 'https://www.aljarida.com/article/123104' },
  { slug: 'in-farewell-to-abdullah-ismail-al-kandariarabic', title: 'في وداع عبد الله إسماعيل الكندري', date: '6 فبراير 2026', iso: '2026-02-06', cat: 'مجتمع',
    excerpt: 'بعض الناس حين يرحلون لا يُطفئون ضوءاً واحداً، بل يُغيّرون شكل العتمة في قلوب من عرفوهم.',
    url: 'https://dr-alfailakawi.com/signature_articles/in-farewell-to-abdullah-ismail-al-kandariarabic/', source: 'https://www.aljarida.com/article/122452' },
  { slug: 'children-who-know-what-is-required-but-do-not-know-whyarabic', title: 'أبناءٌ يعرفون المطلوب… ويجهلون لماذا', date: '30 يناير 2026', iso: '2026-01-30', cat: 'التربية',
    excerpt: 'في المدارس والبيوت نرى مشهداً يتكرر بهدوءٍ مخيف: أبناءٌ يحفظون المطلوب، يُنجزون الواجب، ويعرفون كيف ينجحون… لكنهم يتلعثمون.',
    url: 'https://dr-alfailakawi.com/signature_articles/children-who-know-what-is-required-but-do-not-know-whyarabic/', source: 'https://www.aljarida.com/article/121715' },
  { slug: 'when-seriousness-becomes-a-mask-for-escapearabic', title: 'حين تصبح الجدية قناعاً للهروب', date: '23 يناير 2026', iso: '2026-01-23', cat: 'مجتمع',
    excerpt: 'نركض كثيراً، ونسمّي الركض التزاماً. نملأ يومنا بالمهام، ونسمّي الامتلاء إنجازاً.',
    url: 'https://dr-alfailakawi.com/signature_articles/when-seriousness-becomes-a-mask-for-escapearabic/', source: 'https://www.aljarida.com/article/121017' },
  { slug: 'the-return-that-fails-to-fix-what-came-before-itarabic', title: 'العودة التي لا تُصلِح ما قبلها', date: '9 يناير 2026', iso: '2026-01-09', cat: 'مجتمع',
    excerpt: 'ليست المشكلة في العودة… بل في الوهم الذي نعلّقه عليها. نعود بعد الإجازة بوجوهٍ أكثر نشاطاً.',
    url: 'https://dr-alfailakawi.com/signature_articles/the-return-that-fails-to-fix-what-came-before-itarabic/', source: 'https://www.aljarida.com/article/119714' },
  { slug: 'the-year-that-doesnt-begin-with-the-calendararabic', title: 'السنة التي لا تبدأ من التقويم', date: '2 يناير 2026', iso: '2026-01-02', cat: 'مجتمع',
    excerpt: 'ليس كلُّ عامٍ جديدٍ يبدأ حين تتبدّل الأرقام. بعض السنوات تُولد في الداخل حين ينهزم الوهم ويصحو المعنى.',
    url: 'https://dr-alfailakawi.com/signature_articles/the-year-that-doesnt-begin-with-the-calendararabic/', source: 'https://www.aljarida.com/article/119173' },
  { slug: 'when-truth-died-and-the-narrative-survivedarabic', title: 'حين ماتت الحقيقة ونجت الرواية', date: '26 ديسمبر 2025', iso: '2025-12-26', cat: 'إعلام',
    excerpt: 'نحن لا نعيش أزمة معلومات… نحن نعيش أزمة ثقة. في زمنٍ صار فيه الدليل متعباً، والرواية خفيفة كزرّ «مشاركة».',
    url: 'https://dr-alfailakawi.com/signature_articles/when-truth-died-and-the-narrative-survivedarabic/', source: 'https://www.aljarida.com/article/118554' },
  { slug: 'a-generation-without-rootsarabic', title: 'جيلٌ بلا جذور', date: '19 ديسمبر 2025', iso: '2025-12-19', cat: 'هوية',
    excerpt: 'هذا جيلٌ يعرف كثيراً عن العالم… وقليلاً عن نفسه. يتنقّل بإصبعه بين قاراتٍ لا يعيش فيها.',
    url: 'https://dr-alfailakawi.com/signature_articles/a-generation-without-rootsarabic/', source: 'https://www.aljarida.com/article/117895' },
  { slug: 'a-society-that-fears-the-different-scheduledarabbic', title: 'المجتمع الذي يخاف من المختلف', date: '12 ديسمبر 2025', iso: '2025-12-12', cat: 'مجتمع',
    excerpt: 'المجتمع الذي يخاف من المختلف يربّي أبناءه على فضيلة واحدة: أن يختفوا في الصف.',
    url: 'https://dr-alfailakawi.com/signature_articles/a-society-that-fears-the-different-scheduledarabbic/', source: 'https://www.aljarida.com/article/117250' },
  { slug: 'the-human-who-forgot-himselfarabic', title: 'الإنسان الذي نسي نفسه', date: '5 ديسمبر 2025', iso: '2025-12-05', cat: 'مجتمع',
    excerpt: 'نعيش في زمنٍ يعرف فيه الإنسان كلَّ شيءٍ عن العالم… إلا نفسه.',
    url: 'https://dr-alfailakawi.com/signature_articles/the-human-who-forgot-himselfarabic/', source: 'https://www.aljarida.com/article/116598' },
  { slug: 'intelligence-without-a-consciencearabic', title: 'ذكاءٌ بلا ضمير', date: '28 نوفمبر 2025', iso: '2025-11-28', cat: 'تقنية',
    excerpt: 'كان الناس قديماً يخافون من جهلهم… اليوم نخاف من ذكائنا. لا لأن الآلات بدأت تفكّر، بل لأن الإنسان بدأ يتنازل.',
    url: 'https://dr-alfailakawi.com/signature_articles/intelligence-without-a-consciencearabic/', source: 'https://www.aljarida.com/article/115957' },
  { slug: 'the-success-that-destroyed-us-2', title: 'النجاح الذي دمّرنا', date: '21 نوفمبر 2025', iso: '2025-11-21', cat: 'مجتمع',
    excerpt: 'لم نُخلق لنركض طوال الوقت، لكننا حوّلنا الركض إلى طقسٍ يومي، وعبدنا القمّة حتى نسينا الطريق.',
    url: 'https://dr-alfailakawi.com/signature_articles/the-success-that-destroyed-us-2/', source: 'https://www.aljarida.com/article/115332' },
  { slug: 'when-i-evaluate-my-daughters-school-before-it-evaluates-the-2m', title: 'حين أختبرُ مدرسةَ بناتي… قبل أن تختبرَهنّ', date: '14 نوفمبر 2025', iso: '2025-11-14', cat: 'التربية',
    excerpt: 'لماذا نُسلِّم أبناءنا لمدارس لا نعرفها إلا من الإعلانات؟ لماذا نجعل القبول امتحاناً للطفل؟',
    url: 'https://dr-alfailakawi.com/signature_articles/when-i-evaluate-my-daughters-school-before-it-evaluates-the-2m/', source: 'https://www.aljarida.com/article/114668' },
  { slug: 'laughing-while-burning-2', title: 'يضحك وهو يحترق', date: '7 نوفمبر 2025', iso: '2025-11-07', cat: 'مجتمع',
    excerpt: 'في كل مقطع «ريل» يضحك جيلٌ كامل… ولا يرى أن ضحكته تذوب ببطء.',
    url: 'https://dr-alfailakawi.com/signature_articles/laughing-while-burning-2/', source: 'https://www.aljarida.com/article/113991' },
  { slug: 'the-excellence-epidemic-or-the-cult-of-grades-2', title: 'عقولنا في عُلب ونتساءل: أين الإبداع؟', date: '31 أكتوبر 2025', iso: '2025-10-31', cat: 'التعليم',
    excerpt: 'مدارس تنتج… ولا تبتكر. في كل صباح، يدخل الطلبة إلى صفوف متشابهة: نفس الترتيب، نفس المقاعد، نفس السبورة.',
    url: 'https://dr-alfailakawi.com/signature_articles/the-excellence-epidemic-or-the-cult-of-grades-2/', source: 'https://www.aljarida.com/article/113369' },
  { slug: 'the-blackboard-that-no-longer-sees-anyone-2', title: 'السبورة التي لم تعد ترى أحداً!', date: '24 أكتوبر 2025', iso: '2025-10-24', cat: 'التعليم',
    excerpt: 'كانت ترى الوجوه… تحفظ الأسماء… وتُبحر مع العقول. أما اليوم، فالسبورة نفسها أصبحت مجرد شاشة صمّاء.',
    url: 'https://dr-alfailakawi.com/signature_articles/the-blackboard-that-no-longer-sees-anyone-2/', source: 'https://www.aljarida.com/article/112767' },
  { slug: 'students-minds-are-on-vacation-while-chatgpt-works-full-time-2', title: 'عقول الطلاب في إجازة… وChatGPT يشتغل بدوام كامل!', date: '17 أكتوبر 2025', iso: '2025-10-17', cat: 'تقنية',
    excerpt: 'في زمن الواجبات الذكية، لم يعد السؤال: «هل كتب الطالب؟» بل: «من كتب؟»',
    url: 'https://dr-alfailakawi.com/signature_articles/students-minds-are-on-vacation-while-chatgpt-works-full-time-2/', source: 'https://www.aljarida.com/article/112110' },
  { slug: 'the-teacher-the-last-to-know-2', title: 'المعلّم… آخرُ من يعلم!', date: '10 أكتوبر 2025', iso: '2025-10-10', cat: 'التعليم',
    excerpt: 'تهميشٌ ناعم… لإقصاءٍ صامت. في زمن تُوزّع فيه المناهج بالتوصيل السريع، وتُطبخ السياسات التعليمية خلف الأبواب المغلقة.',
    url: 'https://dr-alfailakawi.com/signature_articles/the-teacher-the-last-to-know-2/', source: 'https://www.aljarida.com/article/111417' },
  { slug: 'dr-jasem-malik-the-lesson-that-never-ends-2', title: 'د. جاسم ملك… الحصّة التي لا تنتهي', date: '3 أكتوبر 2025', iso: '2025-10-03', cat: 'التعليم',
    excerpt: 'ليس كل من يقف أمام السبورة معلّماً، بعضهم ناقل للمعلومة… وبعضهم صانع للإنسان.',
    url: 'https://dr-alfailakawi.com/signature_articles/dr-jasem-malik-the-lesson-that-never-ends-2/', source: 'https://www.aljarida.com/article/110766' },
  { slug: 'the-mind-present-in-absence-absent-in-presence-2', title: 'العقل حاضر في الغياب… وغائب في الحضور!', date: '26 سبتمبر 2025', iso: '2025-09-26', cat: 'التعليم',
    excerpt: 'في كل صباح، تُسجّل الأسماء. فلان؟ موجود. فلانة؟ حاضرة. لكن لا أحد يسأل: هل حضر العقل؟',
    url: 'https://dr-alfailakawi.com/signature_articles/the-mind-present-in-absence-absent-in-presence-2/', source: 'https://www.aljarida.com/article/110108' },
  { slug: 'when-a-student-wishes-for-death-before-the-first-bell-2', title: 'حين يتمنى الطالب الموت… قبل أول جرس!', date: '19 سبتمبر 2025', iso: '2025-09-19', cat: 'التعليم',
    excerpt: 'في صباح أول يوم دراسي، قال المعلم لطلابه: «كل عام وأنتم بخير وعوداً حميداً»، فإذا بأحدهم يرد.',
    url: 'https://dr-alfailakawi.com/signature_articles/when-a-student-wishes-for-death-before-the-first-bell-2/', source: 'https://www.aljarida.com/article/109403' },
  { slug: 'we-handed-them-the-phone-so-theyd-leave-us-alone-2', title: 'سلّمناه الهاتف… ليستريح منا!', date: '12 سبتمبر 2025', iso: '2025-09-12', cat: 'التربية',
    excerpt: 'في زاوية من البيت، يجلس الطفل مشدوهاً أمام شاشة صغيرة، عيناه مشدودتان، فمه نصف مفتوح، وجسده لا يتحرك.',
    url: 'https://dr-alfailakawi.com/signature_articles/we-handed-them-the-phone-so-theyd-leave-us-alone-2/', source: 'https://www.aljarida.com/article/108711' },
  { slug: 'the-republic-of-degrees-and-the-fall-of-thought-2', title: 'جمهورية الشهادات… وسقوط الفكر!', date: '5 سبتمبر 2025', iso: '2025-09-05', cat: 'التعليم',
    excerpt: 'في نظامنا التعليمي، المهم أن تُنجز الورقة، لا أن تفهمها. أن تُكتب الرسالة، لا أن تُغيّر صاحبها.',
    url: 'https://dr-alfailakawi.com/signature_articles/the-republic-of-degrees-and-the-fall-of-thought-2/', source: 'https://www.aljarida.com/article/108037' },
  { slug: 'jarida-202509-001', title: 'الطالب المثالي… مشروع مواطن مطيع؟', date: '1 سبتمبر 2025', iso: '2025-09-01', cat: 'التعليم',
    excerpt: 'الطالب المثالي… مشروع مواطن مطيع؟ في كل مدرسة، هناك "طالب مثالي". هادئ، مرتب، لا يُقاطع، لا يُجادل، لا يسأل كثيرًا.',
    url: '', source: 'https://www.aljarida.com/author/1178/%D8%AF-%D8%A3%D8%AD%D9%85%D8%AF-%D8%AD%D8%B3%D9%8A%D9%86-%D8%A7%D9%84%D9%81%D9%8A%D9%84%D9%83%D8%A7%D9%88%D9%8A' },
  { slug: 'freedom-without-thinking-and-openness-without-awareness-2', title: 'حُرية بلا تفكير… وانفتاح بلا وعي!', date: '29 أغسطس 2025', iso: '2025-08-29', cat: 'مجتمع',
    excerpt: 'لم نعد نناقش المفاهيم، بل نُصفق للشعارات؛ الحُرية أصبحت كلمة يُستدعى بها كل انفلات.',
    url: 'https://dr-alfailakawi.com/signature_articles/freedom-without-thinking-and-openness-without-awareness-2/', source: 'https://www.aljarida.com/article/107391' },
  { slug: 'do-we-contain-or-raise-2', title: 'هل نحتوي… أم نربّي؟', date: '22 أغسطس 2025', iso: '2025-08-22', cat: 'التربية',
    excerpt: 'يعتقد كثير من الآباء أنهم يربّون أبناءهم… لكنهم في الحقيقة فقط «يحتوونهم».',
    url: 'https://dr-alfailakawi.com/signature_articles/do-we-contain-or-raise-2/', source: 'https://www.aljarida.com/article/106768' },
  { slug: 'artificial-intelligence-teaches-while-the-human-mind-is-pushed-aside-2', title: 'الذكاء الاصطناعي يُدرّس… والعقل البشري يُقصى', date: '15 أغسطس 2025', iso: '2025-08-15', cat: 'تقنية',
    excerpt: 'في بعض الفصول، تحوّل المعلم إلى مراقب، والطالب إلى ناقل، وتقدّمت الشاشة خطوة… وتراجع العقل خطوتين.',
    url: 'https://dr-alfailakawi.com/signature_articles/artificial-intelligence-teaches-while-the-human-mind-is-pushed-aside-2/', source: 'https://www.aljarida.com/article/106154' },
  { slug: 'i-write-to-awaken-you-not-to-discourage-you-2', title: 'أكتب لأوقظك… لا لأحبطك!', date: '8 أغسطس 2025', iso: '2025-08-08', cat: 'مجتمع',
    excerpt: 'ما أكتبه ليس تنمُّراً، بل هو حُب قاسٍ. هو ذات المفهوم الذي تُدرِّسه جامعات التربية في الغرب.',
    url: 'https://dr-alfailakawi.com/signature_articles/i-write-to-awaken-you-not-to-discourage-you-2/', source: 'https://www.aljarida.com/article/105490' },
  { slug: 'he-passed-the-exam-but-failed-the-question-2', title: 'نجح في الامتحان… وفشل في السؤال!', date: '1 أغسطس 2025', iso: '2025-08-01', cat: 'التعليم',
    excerpt: 'كل يوم، يدخل الطفل فصله بابتسامةٍ عفوية، ويخرج بورقة تقييم. الابتسامة تذبل تدريجياً، والورقة تكبر.',
    url: 'https://dr-alfailakawi.com/signature_articles/he-passed-the-exam-but-failed-the-question-2/', source: 'https://www.aljarida.com/article/104894' },
  { slug: 'jarida-202508-001', title: '@DrAhmadkw', date: '1 أغسطس 2025', iso: '2025-08-01', cat: 'التربية',
    excerpt: 'قد تبدو كلماتي قاسية، وقد يُساء فهمها. لكنني لا أكتب لأُعجبك…بل لأوقظك. لا أكتب لتربّت على كتفك…بل لأضع مرآة أمامك. في زمن المجاملات، يصبح الصدق تهمة.',
    url: '', source: 'https://www.aljarida.com/author/1178/%D8%AF-%D8%A3%D8%AD%D9%85%D8%AF-%D8%AD%D8%B3%D9%8A%D9%86-%D8%A7%D9%84%D9%81%D9%8A%D9%84%D9%83%D8%A7%D9%88%D9%8A' },
  { slug: 'from-the-schoolyard-to-the-food-court-2', title: 'من الساحة المدرسية… إلى ساحة المطاعم!', date: '25 يوليو 2025', iso: '2025-07-25', cat: 'التربية',
    excerpt: 'في السابق، كانت ساحات المدارس تنبض بالحياة بعد الدوام الرسمي. الطالب يركض من الفصل إلى المسرح.',
    url: 'https://dr-alfailakawi.com/signature_articles/from-the-schoolyard-to-the-food-court-2/', source: 'https://www.aljarida.com/article/104261' },
  { slug: 'we-breastfeed-them-with-tenderness-and-deprive-them-of-education', title: 'نُرضعهم حناناً… ونحرمهم تربية!', date: '18 يوليو 2025', iso: '2025-07-18', cat: 'التربية',
    excerpt: 'نحتفل بضحكتهم، نغمرهم بالهدايا، نلبي كل طلب، ثم نُفاجأ بأنهم لا يحترمون، لا يصبرون، ولا يعرفون حدوداً.',
    url: 'https://dr-alfailakawi.com/signature_articles/we-breastfeed-them-with-tenderness-and-deprive-them-of-education/', source: 'https://www.aljarida.com/article/103628' },
  { slug: 'i-earned-more-than-harvard-but-it-doesnt-teach-brains', title: 'ربحت أكثر من «هارفارد»… لكنها لا تدرّس عقلاً!', date: '11 يوليو 2025', iso: '2025-07-11', cat: 'التعليم',
    excerpt: 'في زمنٍ صارت فيه بعض الجامعات الخاصة تُحقّق أرباحاً تفوق ما تحقّقه جامعة هارفارد، لم تعد المفارقة مضحكة.',
    url: 'https://dr-alfailakawi.com/signature_articles/i-earned-more-than-harvard-but-it-doesnt-teach-brains/', source: 'https://www.aljarida.com/article/103086' },
  { slug: 'excellent-in-grades-lost-in-decision', title: 'ممتاز في الدرجات… ضائع في القرار!', date: '4 يوليو 2025', iso: '2025-07-04', cat: 'التعليم',
    excerpt: 'كان يبتسم، لكن صوته خافت. يحمل ورقة نجاحه بيده، ويُخفي في قلبه سؤالاً لم يُجب عنه أحد.',
    url: 'https://dr-alfailakawi.com/signature_articles/excellent-in-grades-lost-in-decision/', source: 'https://www.aljarida.com/article/102372' },
  { slug: 'we-graduated-with-a-degree-but-the-language-was-lost-2', title: 'تخرَّجنا بشهادة… لكن ضاعت اللغة!', date: '27 يونيو 2025', iso: '2025-06-27', cat: 'هوية',
    excerpt: 'نتقن توقيع الأسماء، وننسى كيف نكتب فكرة. في حفلات التخرُّج، تُرفع القبعات، وتُوزَّع الشهادات، وتُصفِّق الجماهير.',
    url: 'https://dr-alfailakawi.com/signature_articles/we-graduated-with-a-degree-but-the-language-was-lost-2/', source: 'https://www.aljarida.com/article/101723' },
  { slug: 'a-corona-graduate-and-his-education-account-hasnt-been-closed-yet-2', title: 'خرّيج «كورونا»… وحسابه في التعليم لم يُغلق بعد!', date: '20 يونيو 2025', iso: '2025-06-20', cat: 'التعليم',
    excerpt: 'ليس هذا المقال تهجماً… بل نداء للمراجعة. جيلٌ كامل مرّ من بوابات التخرج دون أن يطرق باب الفهم بصدق.',
    url: 'https://dr-alfailakawi.com/signature_articles/a-corona-graduate-and-his-education-account-hasnt-been-closed-yet-2/', source: 'https://www.aljarida.com/article/101112' },
  { slug: 'rest-is-taught-and-the-mind-is-on-permanent-vacation-2', title: 'الراحة تُدرّس… والفكر في إجازة دائمة!', date: '13 يونيو 2025', iso: '2025-06-13', cat: 'التعليم',
    excerpt: 'جيل مريح، لكنه لا يتحمَّل وزن فكرة. في زمن أصبحت الراحة شعاراً تربوياً، بات السؤال الأخطر: هل نحن نُعلّم؟',
    url: 'https://dr-alfailakawi.com/signature_articles/rest-is-taught-and-the-mind-is-on-permanent-vacation-2/', source: 'https://www.aljarida.com/article/100449' },
  { slug: 'coming-soon-a-certificate-without-a-mind-2', title: 'قريباً: شهادة بدون عقل!', date: '6 يونيو 2025', iso: '2025-06-06', cat: 'التعليم',
    excerpt: 'الورق يتخرّج… والعقل غائب. في زمن الشهادات، لا أحد يسأل: ما الذي تعلّمه هذا الخريج فعلاً؟',
    url: 'https://dr-alfailakawi.com/signature_articles/coming-soon-a-certificate-without-a-mind-2/', source: 'https://www.aljarida.com/article/99298' },
  { slug: 'a-certificate-of-excellence-for-a-lifeless-doll-2', title: 'شهادة امتياز… لدمية بلا وعي!', date: '30 مايو 2025', iso: '2025-05-30', cat: 'التعليم',
    excerpt: 'في حفلات التخرّج، نُصفّق طويلاً لصاحب الامتياز، ونهديه شهادة مطرّزة وميدالية براقة، ونلتقط معه الصورة المثالية.',
    url: 'https://dr-alfailakawi.com/signature_articles/a-certificate-of-excellence-for-a-lifeless-doll-2/', source: 'https://www.aljarida.com/article/99298' },
  { slug: 'when-cheating-becomes-intelligence-and-honesty-becomes-stupidity-2', title: 'حين يصبح الغش ذكاءً… والصدق غباءً', date: '23 مايو 2025', iso: '2025-05-23', cat: 'التعليم',
    excerpt: 'في زوايا الصفوف، لم يعد الغش سلوكاً معيباً… بل مهارة تُتداول بصمت.',
    url: 'https://dr-alfailakawi.com/signature_articles/when-cheating-becomes-intelligence-and-honesty-becomes-stupidity-2/', source: 'https://www.aljarida.com/article/98677' },
  { slug: 'we-prepare-our-children-for-success-and-leave-them-empty-handed-2', title: 'نعجن أبناءنا للنجاح… ونُخرجهم فارغين', date: '16 مايو 2025', iso: '2025-05-16', cat: 'التربية',
    excerpt: 'عقولٌ مُخمّرة بالضغط… وأرواحٌ بلا نكهة في مدارسنا. يُعامَل الطفل كما تُعامَل العجينة.',
    url: 'https://dr-alfailakawi.com/signature_articles/we-prepare-our-children-for-success-and-leave-them-empty-handed-2/', source: 'https://www.aljarida.com/article/98051' },
  { slug: 'a-generation-that-knows-everything-and-understands-nothing', title: 'جيل يعرف كل شيء… ولا يفهم شيئاً', date: '9 مايو 2025', iso: '2025-05-09', cat: 'مجتمع',
    excerpt: 'في زمنٍ تسكن فيه المعلومة طرف الإبهام، وتُستدعى باللمس لا بالكدّ، نشأ جيل يعرف كل شيء… ولا يفهم شيئاً.',
    url: 'https://dr-alfailakawi.com/signature_articles/a-generation-that-knows-everything-and-understands-nothing/', source: 'https://www.aljarida.com/article/97388' },
  { slug: 'art-202112-001', title: 'الرياضات الإلكترونية', date: '18 ديسمبر 2021', iso: '2021-12-18', cat: 'تقنية',
    excerpt: 'استطاعت الرياضة الإلكترونية أن تصبح صناعة مستقلة جذبت إليها العديد من الاستثمارات بالمنطقة خلال العقد الأخير ولكن.. وبالرغم من التحديات التي تواجه تلك الصناعة..',
    url: '', source: 'https://www.aljarida.com/author/1178/%D8%AF-%D8%A3%D8%AD%D9%85%D8%AF-%D8%AD%D8%B3%D9%8A%D9%86-%D8%A7%D9%84%D9%81%D9%8A%D9%84%D9%83%D8%A7%D9%88%D9%8A' },
  { slug: 'art-202112-002', title: 'إنه زمن التعليم الذي يحتاج إلى تعليم… إلى أين؟', date: '18 ديسمبر 2021', iso: '2021-12-18', cat: 'التعليم',
    excerpt: 'تصاعد غير مسبوق في صرخات أبناءنا وأولياء أمورهم الناقدة الغاضبة لرداءة التعليم وسوء الحال التعليمي.. ما الحاصل؟ ولما حصل؟!..',
    url: '', source: 'https://www.aljarida.com/author/1178/%D8%AF-%D8%A3%D8%AD%D9%85%D8%AF-%D8%AD%D8%B3%D9%8A%D9%86-%D8%A7%D9%84%D9%81%D9%8A%D9%84%D9%83%D8%A7%D9%88%D9%8A' },
  { slug: 'graduates-in-the-time-of-corona', title: 'خريجو زمن الكورونا.. ولكن!', date: '17 يوليو 2021', iso: '2021-07-17', cat: 'التعليم',
    excerpt: 'أجلس كثيراً مع نفسي.. وبعض الوقت مع الأصدقاء والزملاء — فقد أصبح اللقاء عن بعد في الغالب — نتحدث عن أبنائنا.',
    url: 'https://dr-alfailakawi.com/signature_articles/graduates-in-the-time-of-corona/', source: 'https://www.alqabas.com/article/5856923' },
  { slug: 'qabas-202107-001', title: 'خريجي زمن الكورونا… ولكن!!', date: '6 يوليو 2021', iso: '2021-07-06', cat: 'التعليم',
    excerpt: 'أجلس كثيراً مع نفسي.. وبعض الوقت من الأصدقاء والزملاء –فقد أصبح اللقاء عن بعد في الغالب- نتحدث عن أبناؤنا في زمن الكورونا..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'ethical-hacking-culture', title: 'ثقافة الاختراق الأخلاقي.. قراصنة على خلق', date: '25 مايو 2021', iso: '2021-05-25', cat: 'تقنية',
    excerpt: 'يرتعب الخلق من الاختراقات التي تحدث لهم من الغرباء، فالهاكرز أشخاص مجهولون يهدفون للعبث والقرصنة.',
    url: 'https://dr-alfailakawi.com/signature_articles/ethical-hacking-culture/', source: 'https://www.alqabas.com/article/5850376' },
  { slug: 'turning-video-game-obsession-into-creative-meditation-2', title: 'تحويل هوس ألعاب الفيديو إلى تأمل خلاق', date: '17 أبريل 2021', iso: '2021-04-17', cat: 'التربية',
    excerpt: 'يخبرني الكثير من المعارف والأصدقاء أن أبناءهم الصغار والكبار لديهم هوس في لعب الفيديو.',
    url: 'https://dr-alfailakawi.com/signature_articles/turning-video-game-obsession-into-creative-meditation-2/', source: 'https://www.alqabas.com/article/5845745' },
  { slug: 'past-mistakes-still-persist-in-the-age', title: 'أخطاء الماضي مازالت في زمن التعليم الإلكتروني', date: '20 مارس 2021', iso: '2021-03-20', cat: 'التعليم',
    excerpt: 'نجتمع متباعدين في مجالس عديدة.. وأسمع العجب.. منهم من يتحدث عن مستوى أبنائه بعد تفعيل مدرس خصوصي.',
    url: 'https://dr-alfailakawi.com/signature_articles/past-mistakes-still-persist-in-the-age/', source: 'https://www.alqabas.com/article/5842334' },
  { slug: 'qabas-202103-001', title: 'هوس لعب الفيديو أو الألعاب الإلكترونية… أبناءنا خلاقين', date: '20 مارس 2021', iso: '2021-03-20', cat: 'التربية',
    excerpt: 'يخبرني الكثير من المعارف والأصدقاء أن أبناءهم الصغار والكبار لديهم هوس في لعب الفيديو.. منهم من تعلو صرخاته من هذا الهوس..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'the-media-is-a-vital-partner-in-the-educational-process', title: 'الإعلام الشريك العضيد للعملية التعليمية', date: '11 يناير 2021', iso: '2021-01-11', cat: 'إعلام',
    excerpt: 'كنت أشارك عدداً من الأصدقاء المقربين الحديث عن دور الإعلام في التعليم.. وتحاورنا بهذا الدور العظيم.',
    url: 'https://dr-alfailakawi.com/signature_articles/the-media-is-a-vital-partner-in-the-educational-process/', source: 'https://www.alqabas.com/article/5831454' },
  { slug: 'private-lesson-in-the-age-of-digital-educational-intelligence', title: 'الدروس الخصوصية.. في زمن الذكاء التعليمي الرقمي', date: '17 ديسمبر 2020', iso: '2020-12-17', cat: 'التعليم',
    excerpt: 'ذهبنا هنا وهناك، وكنا نذهب إلى المدارس والجامعات، ونرى أبناءنا على نفس الطريق.',
    url: 'https://dr-alfailakawi.com/signature_articles/private-lesson-in-the-age-of-digital-educational-intelligence/', source: 'https://www.alqabas.com/article/5825899' },
  { slug: 'e-learning-culture-2', title: 'ثقافة التعليم الإلكتروني', date: '8 ديسمبر 2020', iso: '2020-12-08', cat: 'التعليم',
    excerpt: 'أينما جلست ضمن قواعد السلامة المعتادة أجد من يتحدث عن مواقف التربية والتعليم عن التعليم الإلكتروني.',
    url: 'https://dr-alfailakawi.com/signature_articles/e-learning-culture-2/', source: 'https://www.alqabas.com/article/5823187' },
  { slug: 'qabas-202012-001', title: 'الدروس الخصوصية … الأسوار والعبودية… في زمن الذكاء التعليمي الرقمي', date: '8 ديسمبر 2020', iso: '2020-12-08', cat: 'التعليم',
    excerpt: 'ذهبنا هنا وهناك.. وكنا نذهب إلى المدارس والجامعات.. ونرى أبناءنا على نفس الطريق.. والطريق مازال رمز الاستمرارية مع بعض التغييرات.. ولكن المسار اختلف..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'lets-work-towards-scientific-research', title: 'لنعمل من أجل بحث علمي', date: '12 مايو 2020', iso: '2020-05-12', cat: 'بحث',
    excerpt: 'تتفعّل في وقتنا الراهن في ظل أزمة وباء الكورونا (COVID-19) مراكز ومختبرات البحوث للتصدي لهذا الوباء القاتل.',
    url: 'https://dr-alfailakawi.com/signature_articles/lets-work-towards-scientific-research/', source: 'https://www.alqabas.com/article/5773666' },
  { slug: 'e-learning-initiatives-and-solutions-2', title: 'مبادرات وحلول للتعليم الإلكتروني', date: '27 أبريل 2020', iso: '2020-04-27', cat: 'التعليم',
    excerpt: 'بعد إغلاق المدارس والجامعات وفقاً للتدابير الوقائية والاحتياطية للسيطرة على انتشار فيروس كورونا.',
    url: 'https://dr-alfailakawi.com/signature_articles/e-learning-initiatives-and-solutions-2/', source: 'https://www.alqabas.com/article/5770536' },
  { slug: 'qabas-202003-001', title: 'مبادرات حلول للخروج من أزمة التعليم الإلكتروني', date: '30 مارس 2020', iso: '2020-03-30', cat: 'التعليم',
    excerpt: 'في هذا الوقت العصيب وغير المسبوق من انتشار فيروس كورونا حول العالم وإغلاق المدارس والجامعات وفقاً للتدابير الوقائية والاحتياطية للسيطرة عليه، أجبر أعداداً كبيرة من الطلاب على البقاء في المنازل، ونظراً',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'alternative-plans-for-distance-education', title: 'الخطط البديلة للتعليم عن بعد', date: '24 مارس 2020', iso: '2020-03-24', cat: 'التعليم',
    excerpt: 'قلت التجمعات التي كنا نحظى بها من قبل.. والجميع أصبحوا يخشون الخروج من منازلهم بعد العمل.',
    url: 'https://dr-alfailakawi.com/signature_articles/alternative-plans-for-distance-education/', source: 'https://www.alqabas.com/article/5763008' },
  { slug: 'eliminating-the-education-epidemic', title: 'القضاء على وباء التعليم.. بالحزم والعزم', date: '3 مارس 2020', iso: '2020-03-03', cat: 'التعليم',
    excerpt: 'يعيش العالم كابوس فيروس كورونا.. وليس للناس حديث إلا عن هذا الوباء القاتل.',
    url: 'https://dr-alfailakawi.com/signature_articles/eliminating-the-education-epidemic/', source: 'https://www.alqabas.com/article/5757000' },
  { slug: 'qabas-202002-001', title: 'تفشي فايروس الكورونا في التعليم… الحزم والعزم', date: '26 فبراير 2020', iso: '2020-02-26', cat: 'التعليم',
    excerpt: 'يعيش العالم كابوس فايروس الكورونا.. وليس للناس حديث إلا بهذا الوباء القاتل.. نجلس في كل مكان نجد المتخوف ونجد الواعي..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'competency-based-approach-to-the-trash', title: 'منهج الكفايات.. بطريقه إلى المهملات كسابقيه', date: '6 فبراير 2020', iso: '2020-02-06', cat: 'التعليم',
    excerpt: 'نعيش في دولتنا مع وزارة التربية والتعليم نتخبّط بالمناهج.. عثرة وراء عثرة.',
    url: 'https://dr-alfailakawi.com/signature_articles/competency-based-approach-to-the-trash/', source: 'https://www.alqabas.com/article/5749297' },
  { slug: 'smartphone-child-a-creative-mind-or-a-child-being-driven', title: 'طفل الهواتف الذكية.. عقل خلاق أم طفل يساق؟!', date: '1 فبراير 2020', iso: '2020-02-01', cat: 'التربية',
    excerpt: 'سمعت ابني يتحدث لصديقه ويقول «أنا ذكي دون منازع.. نحن أطفال الهواتف الذكية».. تفكرت كثيراً.',
    url: 'https://dr-alfailakawi.com/signature_articles/smartphone-child-a-creative-mind-or-a-child-being-driven/', source: 'https://www.alqabas.com/article/5747496' },
  { slug: 'social-media-and-the-arts-of-learning-crime', title: '«السوشيال ميديا» وفنون تعلم الجريمة «على أصولها»', date: '18 يناير 2020', iso: '2020-01-18', cat: 'مجتمع',
    excerpt: 'كنت في منزل أحد الأصدقاء.. وكان أولاده يلعبون تارة.. ويقلبون الهواتف الذكية تارة أخرى.',
    url: 'https://dr-alfailakawi.com/signature_articles/social-media-and-the-arts-of-learning-crime/', source: 'https://www.alqabas.com/article/5743729' },
  { slug: 'qabas-202001-001', title: 'السوشال ميديا وفنون تعلم الجريمة (على أصولها)', date: '12 يناير 2020', iso: '2020-01-12', cat: 'التربية',
    excerpt: 'كنت في منزل أحد الأصدقاء في منزله.. وكان أولاده يلعبون تارة.. ويقلبون الهواتف الذكية تارة أخرى.. شاهد أحد الأولاد خبر جريمة قتل.. فتفاجأت أنا ووالده عندما صاح لإخوانه..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201912-001', title: 'طفل الهواتف الذكية… عقل خلاق أم طفل يساق', date: '26 ديسمبر 2019', iso: '2019-12-26', cat: 'التربية',
    excerpt: 'سمعت إبني يتحدث لصديقه ويقول (أنا ذكي دون منازع.. نحن أطفال الهواتف الذكية).. تفكرت كثيراً.. أن أبناءنا يعتقدون أن ذكاءهم يرتبط بالهواتف الذكية..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'the-social-media-swamp-and-plastic-surgery-addiction-2', title: 'مستنقع «السوشيال ميديا» وإدمان عمليات التجميل', date: '28 نوفمبر 2019', iso: '2019-11-28', cat: 'مجتمع',
    excerpt: 'عالم السوشيال ميديا يُدخل الفرد منا في متاهات يصعب الخروج منها.. وقد يدمنها البعض.',
    url: 'https://dr-alfailakawi.com/signature_articles/the-social-media-swamp-and-plastic-surgery-addiction-2/', source: 'https://www.alqabas.com/article/5729757' },
  { slug: 'lets-achieve-a-higher-level-of-quality-education', title: 'لنصل إلى مستوى جودة تعليم عالٍ!', date: '17 نوفمبر 2019', iso: '2019-11-17', cat: 'التعليم',
    excerpt: 'سعدنا كثيراً عندما بدأ العمل في الجامعة الجديدة (الشدادية).. وبهرنا بالفخامة المعمارية.',
    url: 'https://dr-alfailakawi.com/signature_articles/lets-achieve-a-higher-level-of-quality-education/', source: 'https://www.alqabas.com/article/5726348' },
  { slug: 'the-teacher-what-do-you-know-about-the-teacher', title: 'المعلم.. وما أدراك ما المعلم', date: '4 نوفمبر 2019', iso: '2019-11-04', cat: 'التعليم',
    excerpt: 'التقيت مع صديق لي فوجدته غاضباً محتداً بعض الشيء، مرسوماً على وجهه الحزن.',
    url: 'https://dr-alfailakawi.com/signature_articles/the-teacher-what-do-you-know-about-the-teacher/', source: 'https://www.alqabas.com/article/5722716' },
  { slug: 'qabas-201911-001', title: 'الشدادية فخامة معمارية… ولكن نحو جودة التعليم', date: '3 نوفمبر 2019', iso: '2019-11-03', cat: 'التعليم',
    excerpt: 'سعدنا كثيراً عندما بدأ العمل في الجامعة الجديدة (الشدادية).. وبهرنا بالفخامة المعمارية التي جادوا بها أبدع المهندسين والمعماريين.. وكانت الفرحة عارمة بأن تحقق الحلم..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201910-001', title: 'المعلم وما أدراك ما المعلم… يا جمعه', date: '16 أكتوبر 2019', iso: '2019-10-16', cat: 'التعليم',
    excerpt: 'التقيت مع صديق لي.. فوجدته غاضباً محتداً بعض الشيء.. مرسوم على وجهه الحزن.. قلت له أن يتوكل على الله وأن يتحدث إن أراد.. ليوسع عن صدره.. فصدمني مما سمعت..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'social-media-and-false-wealth', title: 'السوشيال ميديا.. والثراء الكاذب', date: '12 أكتوبر 2019', iso: '2019-10-12', cat: 'مجتمع',
    excerpt: 'هراء.. نعم، هراء.. هذا ردي لكل من يتحدث عن ثراء الفاشينستات (رجالاً ونساءً).. هذا الثراء الفاحش.',
    url: 'https://dr-alfailakawi.com/signature_articles/social-media-and-false-wealth/', source: 'https://www.alqabas.com/article/5715916' },
  { slug: 'qabas-201909-001', title: 'السوشيل ميديا والثراء الكاذب', date: '22 سبتمبر 2019', iso: '2019-09-22', cat: 'إعلام',
    excerpt: 'هراء هراء هراء.. نعم هراء.. هذا ردي لكل من يتحدث عن ثراء الفاشينستات.. هذا الثراء الفاحش..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'todays-childs-confusion-between-education-and-care', title: 'حيرة طفل اليوم.. ما بين التربية والرعاية', date: '5 سبتمبر 2019', iso: '2019-09-05', cat: 'التربية',
    excerpt: 'ما إن نجلس في مجلس إلا ونجد من يكون غائباً عن المجلس بفكره.. حائراً كحيرة طفل اليوم.',
    url: 'https://dr-alfailakawi.com/signature_articles/todays-childs-confusion-between-education-and-care/', source: 'https://www.alqabas.com/article/5704736' },
  { slug: 'qabas-201908-002', title: 'طفل اليوم حائر… ما بين التربية والرعاية', date: '31 أغسطس 2019', iso: '2019-08-31', cat: 'التربية',
    excerpt: 'ما أن نجلس في مجلس إلا ونجد من يكون غائب عن المجلس بفكره.. حائر كحيرة طفل اليوم..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'are-our-phones-listening', title: 'تلفوناتنا تسمع؟!', date: '29 أغسطس 2019', iso: '2019-08-29', cat: 'تقنية',
    excerpt: 'في كل مكان أجتمع به مع الأهل أو الأصدقاء والزملاء، أجدهم يتحدثون عن طفرات تحصل وكأنها من الوهم.',
    url: 'https://dr-alfailakawi.com/signature_articles/are-our-phones-listening/', source: 'https://www.alqabas.com/article/5703000' },
  { slug: 'qabas-201908-001', title: 'تلفوناتنا تسمع ؟!!؟', date: '24 أغسطس 2019', iso: '2019-08-24', cat: 'التعليم',
    excerpt: 'في كل مكان أجتمع به مع الأهل أو الأصدقاء والزملاء أجدهم يتحدثون عن طفرات تحصل وكأنه من الوهم.. فكان الأمر المتداول بينهم أن "تلفوني يسمعني"!..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'in-their-opinion-surgery-is-a-male-specialty-2', title: 'الجراحة برأيهم تخصص رجولي..؟!', date: '15 أغسطس 2019', iso: '2019-08-15', cat: 'مجتمع',
    excerpt: 'اشتعلت مواقع التواصل والناس بمختلف الدول غضباً على تصريح جازم بالنفي.',
    url: 'https://dr-alfailakawi.com/signature_articles/in-their-opinion-surgery-is-a-male-specialty-2/', source: 'https://www.alqabas.com/article/5698972' },
  { slug: 'have-mercy-on-us-social-media-giants-2', title: 'ارحمونا يا فطاحلة السوشيال ميديا..!', date: '30 يوليو 2019', iso: '2019-07-30', cat: 'مجتمع',
    excerpt: 'كنت في عزاء أحد الأقارب، فوجدت أحد الأشخاص بعكازه وقد أصابته جلطة حسب كلامه قبل فترة.',
    url: 'https://dr-alfailakawi.com/signature_articles/have-mercy-on-us-social-media-giants-2/', source: 'https://www.alqabas.com/article/5694832' },
  { slug: 'qabas-201907-002', title: 'الجراحة برأيهم تخصص رجولي… أهي سقطات أم ابتذال صريح… يا هداكم الله', date: '30 يوليو 2019', iso: '2019-07-30', cat: 'التربية',
    excerpt: 'اشتعلت مواقع التواصل والناس بمختلف الدول غضباً على تصريح جازم بالنفي أنه "لا يوجد في العالم دكتورة جراحة متميزة.. وإن وجدت إما غير متزوجة أو مسترجلة"..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201907-001', title: 'ارحمونا يا فطاحلة السوشال ميديا…', date: '24 يوليو 2019', iso: '2019-07-24', cat: 'التعليم',
    excerpt: 'كنت في عزاء أحد الأقارب لنا قبل فترة بسيطة..فوجدت أحد الأشخاص بعكازه وقد أصابته جلطة حسب كلامه قبل فترة.. فوجدت الكثيرين من المعارف يتحدثون تاره..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'the-open-market-for-acquiring-degrees-a-scientific-or-ethical-crisis', title: 'السوق المفتوح لاقتناء الشهادات أزمة علمية أم أخلاقية؟', date: '22 يونيو 2019', iso: '2019-06-22', cat: 'التعليم',
    excerpt: 'عدنا والعود أحمد، بعد الغياب نعود لنرصد أهم الموضوعات التي نتبادل فيها الآراء ووجهات النظر.',
    url: 'https://dr-alfailakawi.com/signature_articles/the-open-market-for-acquiring-degrees-a-scientific-or-ethical-crisis/', source: 'https://www.alqabas.com/article/682808' },
  { slug: 'qabas-201906-001', title: 'السوق المفتوح لاقتناء الشهادات -أزمة علمية أم أزمة أخلاق', date: '16 يونيو 2019', iso: '2019-06-16', cat: 'التعليم',
    excerpt: 'عدنا والعود أحمد،، بعد الغياب نعود لنرصد أهم الموضوعات التي نتبادل فيها الآراء ووجهات النظر مع كل الاحترام.. وارتأيت بعد أن صادفني الكثير من الجدل مع الزملاء والناس..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201811-001', title: 'وسائل الإعلام… بين المجاملة والتمثيل', date: '23 نوفمبر 2018', iso: '2018-11-23', cat: 'إعلام',
    excerpt: 'منذ أن جاءت السيول وما أحدثته من مضار على بلادنا الحبيبة الكويت.. لم نجتمع مع أصدقائنا والمقربين.. وجاءت جمعتنا منذ كم يوم بالصدفة..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201811-002', title: 'انجازات تغرق وفساد يعوم', date: '23 نوفمبر 2018', iso: '2018-11-23', cat: 'التربية',
    excerpt: 'مضت أيام بغيماتها السوداء على وطننا الكويت ساد فيها الغرق.. ليالي خائفة من سيول جرفت بطريقها كل من كان بوجهها..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201810-001', title: 'أصول التوجيه للطلبة… فلكل مقام مقال…', date: '25 أكتوبر 2018', iso: '2018-10-25', cat: 'التعليم',
    excerpt: 'اشتكى أحد أولياء الأمور معلمي أحد المدارس.. حيث أن المعلمين يقومون في توجيه الأطفال بطابور الصباح من خلال محاضرة يلقونها عليهم..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201810-002', title: 'سر اليوتيوب… وغموض المحتوى', date: '25 أكتوبر 2018', iso: '2018-10-25', cat: 'تقنية',
    excerpt: 'كنت أجلس مع عدد من لديهم اهتمامات ومتابعات على اليوتيوب.. أخبرتهم أني أرى شيء غريب في اليوتيوب.. وأن المحتوى الذي يتم تنزيله لي يبدو فيه الغموض في بعض الأحيان.. فسألوني..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201810-003', title: 'مواقع الإلحاد في السوشيال ميديا… وقد فاحت راحئتها', date: '25 أكتوبر 2018', iso: '2018-10-25', cat: 'تقنية',
    excerpt: 'بقدر ما كنا نتحدث عن إيجابيات السوشيال ميديا.. وكنا نستبشر بها الخير للجميع.. بدأنا نستاء لبعض محتوياتها التي ضاقت بها الصدور..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201810-004', title: 'لنعمل من أجل أنفسنا لا من أجل الآخرين…', date: '25 أكتوبر 2018', iso: '2018-10-25', cat: 'التعليم',
    excerpt: 'بدأ منذ فترة العام الدراسي الجديد.. وبدأت المخاوف لدى الطلبة في تحديد مصيرهم ومستقبلهم.. وينبع هذا الخوف من مقاومة الآخرين لرغباتهم الوظيفية المستقبلية..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201808-001', title: 'ضياع المضمون في زحام الدراما', date: '29 أغسطس 2018', iso: '2018-08-29', cat: 'التربية',
    excerpt: 'في الماضي كان الأهل يدعون أبنائهم والعائلة للتجمع حول التلفاز.. هذا واقع عشناه ومن قبلنا من جيل الطيبين.. نجتمع لنشاهد أعمالاً درامية قمة في الروعة..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201808-002', title: 'السوشيل ميديا… وما شذ وطاب', date: '29 أغسطس 2018', iso: '2018-08-29', cat: 'تقنية',
    excerpt: 'السوشيل ميديا وما أدراك ما السوشيل ميديا.. في فترة الاستراحة بين المحاضرات.. جلست أتصفح في جوالي ومع فنجان قهوتي.. بعض المواقع ومنها اليوتيوب..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201807-001', title: 'القدوة العلمية… وتصدع الأجيال', date: '13 يوليو 2018', iso: '2018-07-13', cat: 'التربية',
    excerpt: 'في إحدى اللقاءات الإذاعية ذكر المبدع أ. خالد الجمعان أننا نفتقر للقدوة العلمية.. وقد ذكر أن له قدوة يفتخر بها وهو عالم معروف في سماء الكويت والعالم هو العم د.',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201806-003', title: 'يمكنك إيقاف phubbing "التعلّق باستخدام الهاتف"', date: '29 يونيو 2018', iso: '2018-06-29', cat: 'مجتمع',
    excerpt: 'جاءني عدد كبير من التفاعل في موضوع الفوبنج phubbing.. من الطلبة أو الزملاء ومن القراء الكرام.. وأعجبوا في المصطلح..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201806-004', title: 'المافيا المجتمعية… تفشي وخطر مجتمعي…', date: '29 يونيو 2018', iso: '2018-06-29', cat: 'مجتمع',
    excerpt: 'نتحاور كثيراً مع أصحاب الضمائر الحية.. والتي تنبذ السلوكيات الخطيرة الخاطئة التي تفشت في مجتمعاتنا.. وقد وصلنا إلى أن هؤلاء مافيات مجتمعية خطيرة على مجتمعنا..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201806-005', title: 'Phubbing… وعاداتها السيئة', date: '29 يونيو 2018', iso: '2018-06-29', cat: 'مجتمع',
    excerpt: 'في إحدى الإطلاعات والبحوث التي نجريها في التكنولوجيا وآثارها سواء أكانت الإيجابية منها أم السلبية.. وعملية البحث الدائمة في هذا الموضوع..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201806-001', title: 'كلية التربية… البقرة الحلوب', date: '5 يونيو 2018', iso: '2018-06-05', cat: 'التربية',
    excerpt: 'في ضوء كوني دكتور في كلية التربية الأساسية.. فإني أرى أن هناك رؤى مجحفة في حق هذه الكلية العريقة وكذلك في كلية التربية جامعة الكويت..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201806-002', title: 'إلى من يعترض على قرارات وزير التربية في الغش', date: '5 يونيو 2018', iso: '2018-06-05', cat: 'التربية',
    excerpt: 'كانت المشاهدات والمشادات في الأيام الماضية نتيجة لقرار معالي وزير التربية في الغش.. شاحنة.. ومليئة بالغضب من الطلبة وأولياء الأمور..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201805-003', title: 'دور المعلم… كوسيلة إعلامية', date: '22 مايو 2018', iso: '2018-05-22', cat: 'التعليم',
    excerpt: 'تبادل في ذهني في فترة من الفترات الكثير من المصطلحات التي لابد أن تدخل مجال التربية لتعزيز وتقوية دور ومكانة المعلم..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201805-004', title: 'تحية لوزير التربية… رجل القرارات الشجاعة', date: '22 مايو 2018', iso: '2018-05-22', cat: 'التعليم',
    excerpt: 'في الماضي كان الغش لا يخرج عن ورقة وقلم.. أو على البنطلون والبنات على المريول.. يتم نحت المادة أو جزئية منها.. وتبدأ البراشيم في الإمتحان بالخروج على أشكالها البسيطة..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201805-002', title: 'لا تخطؤوا خطأ الصين…', date: '21 مايو 2018', iso: '2018-05-21', cat: 'التربية',
    excerpt: 'ناقشت مع بعض طلبتي موضوع اختيار التخصص.. فوجدت أن غالب الطلبة تعرضوا لكبح وضغط نفسي شديد في اختياراتهم.. فمنهم من ترى العائلة أن ابنهم متميز ولابد أن يدرس الطب..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201805-001', title: 'نعم لخصخصة التعليم… نظرة إصلاحية', date: '9 مايو 2018', iso: '2018-05-09', cat: 'التعليم',
    excerpt: 'توقفوا عن الهرج والمرج.. دعونا نرتقي لتعليم أفضل.. يكفي تدني في مستوى التعليم.. هذا ما وقفت أقوله لعدد من الحضور في تجمع كنا نجلس ونتحدث عن موضوع خصخصة التعليم في الكويت..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201804-001', title: 'مدرسة غابة الإبداع… والضياع', date: '4 أبريل 2018', iso: '2018-04-04', cat: 'التعليم',
    excerpt: 'مو من زمان.. كان.. فيه غابة يعيش فيها مجتمع طموح.. يملؤه الأمل والطيبة.. يريدون الخير للجميع.. يعلمون أبناؤهم كيف يبنون غابة الإبداع..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201803-003', title: 'طلبتنا ومعلميهم في طريقهم إلى التصحر النفسي…', date: '20 مارس 2018', iso: '2018-03-20', cat: 'التعليم',
    excerpt: 'قرأت العديد من ردود الأفعال من أولياء الأمور والمعلمين عما يواجهونه في عملية التعليم والتعلم.. وقد التقيت بولي أمر طالب قال لي: إنها ميدان للمعارك وليست مدرسة..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201803-001', title: 'منهج الكفايات… ما بين الإنجاز وسوء التخطيط… وردود الأفعال', date: '12 مارس 2018', iso: '2018-03-12', cat: 'التعليم',
    excerpt: 'تصاعدت ردود الأفعال بعد المقال السابق "ملاحظات في منهج الكفايات"، وكنت أخشى أن تكون تلك الردود نابعة من شعور الخيبة لانحدار مخرجاتنا التعليمية بين أبنائنا الطلبة، وارتعدت أصوات أولياء الأمور..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201803-002', title: 'المنهج الوطني… ما بين الإنجاز وسوء التخطيط… وردود الأفعال', date: '12 مارس 2018', iso: '2018-03-12', cat: 'التعليم',
    excerpt: 'تصاعدت ردود الأفعال بعد المقال السابق "سقطات في المنهج الوطني الجديد"، وكنت أخشى أن تكون تلك الردود نابعة من شعور الخيبة لانحدار مخرجاتنا التعليمية بين أبنائنا الطلبة، وارتعدت أصوات أولياء الأمور..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201802-005', title: 'وحدة التحكم المصغرة Ebots … عقول كويتية تنافس عقول الدول المتقدمة', date: '17 فبراير 2018', iso: '2018-02-17', cat: 'تقنية',
    excerpt: 'المطورون.. المهندس أحمد الصالح والمهندس ناصر الخالدي.. نعم هؤلاء عقول كويتية ابتكرت وحدة التحكم المصغرة والتي تعد طفرة في عالم الابتكارات..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201802-006', title: 'وحدة التحكم المصغرة Ebot … عقول كويتية تنافس عقول الدول المتقدمة', date: '17 فبراير 2018', iso: '2018-02-17', cat: 'تقنية',
    excerpt: 'المطورون.. المهندس أحمد الصالح والمهندس ناصر الخالدي.. نعم هؤلاء عقول كويتية ابتكرت وحدة التحكم المصغيرة والتي تعد طفرة في عالم الابتكارات..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201802-004', title: 'كليات التربية ومتطلبات العصر', date: '13 فبراير 2018', iso: '2018-02-13', cat: 'التعليم',
    excerpt: 'كثيراً ما أجلس مع نفسي أو مع بعض الزملاء المقربين في الكلية.. نتداول الهموم التعليمية وما آلت عليه العملية التعليمية.. وحال التعليم في المدارس..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201802-003', title: 'أزمة تطوير التعليم … ما بين تدريب وتأهيل المعلمين', date: '12 فبراير 2018', iso: '2018-02-12', cat: 'التعليم',
    excerpt: 'أستاذ يربي أجيال.. ومخرجات المستقبل إلى سوق العمل.. ما بين أزمة تدريب وتأهيل المعلمين.. وكليات التربية.. هذا ما انتهى به نقاش طويل بين نخبة من أساتذة الجامعات والمدارس..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201802-001', title: 'سقطات في منهج الكفايات…', date: '11 فبراير 2018', iso: '2018-02-11', cat: 'التعليم',
    excerpt: 'عند زيارتي للعديد من المداس لإلقاء محاضرات.. تيقنت أن الأصوات تتعالى تذمراً من منهج الكفايات الجديد.. ذهبت لتقصي أسباب هذا التذمر..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201802-002', title: 'المخدرات الرقمية… إدمان جديد… حقيقة أم وهم…', date: '11 فبراير 2018', iso: '2018-02-11', cat: 'تقنية',
    excerpt: 'ضرب من الجنون.. هذا ما قاله صديقي الحائر.. أنا: ولكن يا صديقي قد تكون الوفاة لها أسباب أخرى.. صديقي: لالا لقد شاهدت بأم عينيك الضجة وراء هذا الأمر..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201712-004', title: 'نحن… ما بعد التكنولوجيا…', date: '23 ديسمبر 2017', iso: '2017-12-23', cat: 'تقنية',
    excerpt: 'ذهبت من أيام إلى لاستخراج ورقة لي شخصياً من الكلية.. وكان الوضع يسوده البلبله وحالة من الإحباطات.. نظرت باستغراب.. وسألت أحدهم عما يحدث..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201712-001', title: 'مجلس علم… للشيخ جوجل', date: '18 ديسمبر 2017', iso: '2017-12-18', cat: 'التعليم',
    excerpt: 'زارني صديق يعمل في مجال الفقه والأصول.. ويشتكي ضيق الوقت في جمع المعلومات من الكتب الفقهية والأصولية.. والدراسات ذات الصلة أثناء تحضيره لأطروحة الدكتوراه..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201712-002', title: 'تكنولوجيا الواقع المعزز… هل هي صديقة الإنسان أم خروج عن السيطرة؟', date: '18 ديسمبر 2017', iso: '2017-12-18', cat: 'تقنية',
    excerpt: 'وأنا في طريقي إلى المنزل.. جاءتني مجموعة من الفيديوهات عن تكنولوجيا الواقع المعزز من طلبتي الجامعيين ومن الزملاء.. عند وصولي.. جلست أشاهدها..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201712-003', title: 'هل وظيفتك مهددة بالانقراض؟', date: '18 ديسمبر 2017', iso: '2017-12-18', cat: 'تقنية',
    excerpt: 'كنت أتصفح أفكار المفكرين في مجال مستجدات التكنولوجيا.. فسقطت عيناي على فكرة اختفاء بعض الوظائف.. فتوجست خيفة من مستقبل الكثيرين ممن أعرفهم من أهلي وأصدقائي..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201711-004', title: 'أحدث صيحات الموضة التكنولوجية', date: '8 نوفمبر 2017', iso: '2017-11-08', cat: 'تقنية',
    excerpt: 'تعج حياتنا بأحدث صيحات الموضة.. وتركض النساء والرجال والشباب والأطفال لمواكبة صخب تلك الصيحات التي أصبحت نموذج العصر..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201711-001', title: 'معوقات نقل التكنولوجيا…', date: '7 نوفمبر 2017', iso: '2017-11-07', cat: 'تقنية',
    excerpt: 'أتمعن كثيراً في موضوع الإستثمار في الدول النامية كأحد العوامل الأساسية التي تدخل في تطور المؤسسات وكذا الإقتصاد العام، وكيف أنه يسمح بخلق مناصب عمل جديدة ومواكبة العصر بما جاء معه من تطور تكنولوجي وتق',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201711-002', title: 'شيخوخة المعلومات', date: '7 نوفمبر 2017', iso: '2017-11-07', cat: 'مجتمع',
    excerpt: 'في لحظات بحثي المتنوع في كافة المجالات.. وقعت عيناي على دراسات حديثة تتحدث عن الشيخوخة..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201711-003', title: 'هل سينتهي عصر الهواتف الذكية؟', date: '7 نوفمبر 2017', iso: '2017-11-07', cat: 'التعليم',
    excerpt: 'دخلت المنزل بعد يوم عمل طويل.. ووجدت ابني الصغير يتصفح على اللابتوب.. التفت إليّ بلهفة سائلاً: بابا هل ستنتهي الهواتف الذكية يوماً من الأيام؟..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201709-006', title: 'وسائل الإعلام التقليدي والإلكتروني… وسائل دفاع للوحدة الخليجية', date: '25 سبتمبر 2017', iso: '2017-09-25', cat: 'إعلام',
    excerpt: 'حزينٌ أنت يا خليجنا لما آل عليه الحال.. ورغم ذلك فالحزن بالقلب.. والقلم ينبض بما تدركه عقولنا التي تستمد الحكمة من منبع الحكمة.. صباح الكويت..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201709-007', title: 'انهيار قيم … أم استنفاذ همم…', date: '25 سبتمبر 2017', iso: '2017-09-25', cat: 'التربية',
    excerpt: 'جاءني احدى الطلاب في الكلية.. يبدو عليه الحيرة.. فقمت بتعزيز ثقته لتتحدث براحه.. بدأ وكأنه قلق.. ثم بدأ بالكلام بخطى مترددة.. أسبرت له في الكلام من أجل تخطي حالة التردد..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201709-008', title: 'وعي المواطن الخليجي … والحرب الافتراضية', date: '25 سبتمبر 2017', iso: '2017-09-25', cat: 'هوية',
    excerpt: 'كبرنا على مدى أجيال.. ونحن ندرك أن لنا وطنان.. وطننا الأم الذي ولدنا ونشأنا فيه يستحق منا الحب والولاء والانتماء.. والوطن المتجسد بالخليج العربي الحضن الكبير..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201709-009', title: 'لا للإملاءات الخارجية… وتصعيد الخطاب السياسي', date: '25 سبتمبر 2017', iso: '2017-09-25', cat: 'التعليم',
    excerpt: 'كنت أجلس مساء يومي الحافل بالعمل.. أتصفح آخر الأخبار لأزمة الحصار.. وهمومنا الداخلية التي ذابت في الهموم الكبيرة.. وجدت أن الخطاب السياسي في مواقع التواصل قد تعالت..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201709-002', title: 'أدخل إلى عالم التعليم الالكتروني من أبسط تطبيقات جوالك…', date: '17 سبتمبر 2017', iso: '2017-09-17', cat: 'تقنية',
    excerpt: 'قديما كان مجرد متابعة برنامج تعليمي على التلفاز يعتبر من تكنولوجيا التعليم.. وكان حاسوبنا الكثير يعلم ممن عاصر جيل قمة التكنولوجيا –زمن الطيبين-.. حاسوب صخر..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201709-003', title: 'حوار الحكمة… في وجه الحصار', date: '17 سبتمبر 2017', iso: '2017-09-17', cat: 'تقنية',
    excerpt: 'أصبح شغلنا الشاغل عبر المواقع الإلكترونية والإعلام التقليدي متابعة المستجدات.. ومساعي كويتنا الحبيب لحل الأزمة الخليجية..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201709-004', title: 'شبكات التواصل الاجتماعي تجمعنا… خط الدفاع', date: '17 سبتمبر 2017', iso: '2017-09-17', cat: 'مجتمع',
    excerpt: 'يوماً كنت جالساً في الديوانية مع العائلة .. وبعض الأصدقاء وأبناء العمومة.. وقد ذهلت لتجمعهم.. فعند اتصال أحد الأعمام وطلبه مني للحضور واللمه الجميله..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201709-005', title: 'كثرة التطبيقات التعليمية… وعدم الجدوى في الواقع التربوي', date: '17 سبتمبر 2017', iso: '2017-09-17', cat: 'التعليم',
    excerpt: 'استكمالاً لما أوردناه في مقالة سابقة عن كثرة التطبيقات التعليمية وعدم وجود أثر لها في الواقع التعليمي..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201709-001', title: 'السوشل ميديا… محك للأزمات', date: '4 سبتمبر 2017', iso: '2017-09-04', cat: 'هوية',
    excerpt: 'كنا في الماضي ننتظر نشرة الأخبار لكي نعرف أخبار العالم.. ولم تكن مصادرنا بالأخبار كثيرة التنوع.. فهي مكونة من موجز نشرة الأخبار في الصباح وساعات الظهر..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201708-001', title: 'السعادة قبل أن تسرقها التكنولوجيا', date: '12 أغسطس 2017', iso: '2017-08-12', cat: 'التربية',
    excerpt: 'عدت من العمل وطرقت الباب.. ودخلت دون أن أدق جرس الباب.. استقبلني طفلي وتعلق كعادته بي وحضنني.. وحملته وضحكاتنا تتعالى.. كانت زوجتي في المطبخ..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201708-002', title: 'طوفان قيم الواقع الافتراضي', date: '12 أغسطس 2017', iso: '2017-08-12', cat: 'تقنية',
    excerpt: 'كنت أحضر لندوة ما.. وأغرق بين الأوراق.. بالإضافة إلى الإبحار بعالم المعلومات على المواقع.. حتى جاء ابني يسألني.. بابا..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201708-003', title: 'الأجهزة اللوحية تتصدر لائحة مسببي التوحد', date: '12 أغسطس 2017', iso: '2017-08-12', cat: 'تقنية',
    excerpt: 'في إحدى جمعاتنا بين الأصدقاء.. استفقدنا أحدهم.. فبدأنا تنساءل عن غيابه.. وتفاجأنا بأنه مسافر لعلاج ابنه.. الذي بدأت عليه حالات غريبة كالانطوائية والانعزال والهزال..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201707-001', title: 'تقنية النظارات3D تغزو التعليم الجامعي', date: '7 يوليو 2017', iso: '2017-07-07', cat: 'التعليم',
    excerpt: 'لفترة ليست ببعيدة كان التعليم الجامعي يعتمد على أسلوب التلقين، وهذا ما ساد في العملية التعليمية، ولكن مع التطور الذي واكبناه من قريب أو من بعيد، تم إدخال العديد من الطرق التعليمية الحديثة، ولمجارات ال',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201707-002', title: 'العالم إلى أين… نظرة مستقبلية', date: '7 يوليو 2017', iso: '2017-07-07', cat: 'التعليم',
    excerpt: 'كثيراً ما أتداول مع نفسي.. ترى هل سينتهي دور المعلم الذي يقف أمام سبورته ويشرح الدرس ويطالب طلبته بتسجيل ما يكتبه.. وما يقوله في دفاترهم..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201707-003', title: 'الجوازات الذكية (الإلكترونية) أدوات تقتحم الخصوصية', date: '7 يوليو 2017', iso: '2017-07-07', cat: 'تقنية',
    excerpt: 'ذهبت لاستبدال جوازي بالجواز الذكي.. فوجدت الكثير يتساءل عن سر تلك الجوازات.. وسمعت الكثير والكثير.. وعلامات استفهام أكثر حولها..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201707-004', title: 'التكنولوجيا تغزو 40% من سكان الكوكب…', date: '7 يوليو 2017', iso: '2017-07-07', cat: 'تقنية',
    excerpt: 'كنت أجلس مع والدي في أحد الأيام وكان معه عدد من أصدقائه.. وكان أحدهم يقول: أن أحفاده لا يريدون أن يغيروا له مطبخه القديم المتهالك..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201706-001', title: 'الواقع الافتراضي يميط اللثام عن الوجه الحقيقي للبشر', date: '6 يونيو 2017', iso: '2017-06-06', cat: 'تقنية',
    excerpt: 'أتذكر أول ظهور الوسائط المتعددة.. والألوان والصور والكتابة النصية المتقدمة..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201706-002', title: 'هذه المرة نقف مع التلفاز…', date: '6 يونيو 2017', iso: '2017-06-06', cat: 'التعليم',
    excerpt: 'التلفاز قصة جميلة نستذكر فيها جمعت الأهل والأصدقاء والجيران.. وحياتنا التعليمية من خلال التلفاز قصة طويلة.. فقد كانت من ضمن التطور التعليمي.. أقصد طرق التدريس..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201706-003', title: 'هل وضعت البشرية بيضها في سلة واحدة عندما رهنت التكنولوجيا بالكهرباء', date: '6 يونيو 2017', iso: '2017-06-06', cat: 'تقنية',
    excerpt: 'في الماضي كنا نعيش التقدم في جميع مراحله وفق تدرج معقول.. وكنت أسمع والدي والأهل يتحدثون عن أيام أول.. في وقت لم تكن الكهرباء منتشرة.. وكيف دخلت وانتشرت..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201706-004', title: 'وداوني بالتي كانت هي الداء…', date: '6 يونيو 2017', iso: '2017-06-06', cat: 'تقنية',
    excerpt: 'نمر كثيراً بضغوطات الحياة والعمل.. فنبحث عن مجددات للطاقة والنفسية.. وفي السياق نبحث أيضاً عن مجدد لحركة أبداننا..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201704-001', title: 'الترجمة بين التكنولوجيا ومجالات الحياة …', date: '30 أبريل 2017', iso: '2017-04-30', cat: 'تقنية',
    excerpt: 'جميل أن يجلس المرء منا مع زملائنا نتناقش ونتدبر مجالات الحياة في إطار عملنا أو تخصصنا أو في غير ذلك..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201704-002', title: 'الذوق التكنولوجي يفسد الذوق الطبيعي…', date: '30 أبريل 2017', iso: '2017-04-30', cat: 'تقنية',
    excerpt: 'جلست طويلاً في أحد سفراتي للدول الأوربية أنظر إلى الطبيعة الجميلة من الزهور والورود الهجينة التي لا يكاد بها رائحة.. والأشجار التي بدأت تثمر ثماراً اختلفت عما قبل..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201704-003', title: 'العصر السبراني حقيقة أم مجرد خيال…', date: '30 أبريل 2017', iso: '2017-04-30', cat: 'التربية',
    excerpt: 'جلست أقلب التلفاز وإذ بفيلم سبايدر مان الجزء الثاني (Spiderman 2)، الذي تابعناه بشغف.. وكان حلم الجميع بأن يتحقق يوماً..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201704-004', title: 'توظيف التقنيات التكنولوجية في الخطاب الديني…', date: '30 أبريل 2017', iso: '2017-04-30', cat: 'تقنية',
    excerpt: 'كنت جالساً بعد محاضراتي الطويله أقرأ بحثاً لفت انتباهي.. وقد كان بحثاً عن استخدام التكنولوجيا في التعليم والخطاب الديني.. نعم.. لقد لفت انتباهي أنه في الدين..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201703-001', title: 'أما آن لنا أن نعيد توجيه التقدم التكنولوجي نحو الأولويات الحقيقة', date: '27 مارس 2017', iso: '2017-03-27', cat: 'تقنية',
    excerpt: 'كنت أجلس في مكتبي أحضر لبحث سأقوم بنشره عن أهمية التعليم الإلكتروني.. تأملت قليلاً بمنظومة التعليم العام والعالي.. انتابني شيء من القلق والغبطة..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201703-002', title: 'التكنولوجيا تسهل دس السم في الدسم', date: '27 مارس 2017', iso: '2017-03-27', cat: 'تقنية',
    excerpt: 'كنت أتصفح بعض الصفحات الإلكترونية.. وأقرأ موضوعات مختلفة في بعض المدونات.. شعرت أنني أغرق في مستنقع التدليس على ما جاء به إسلامنا الحنيف..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201703-003', title: 'تكنولوجيا عالمية تحتاج تشريعات عالمية', date: '27 مارس 2017', iso: '2017-03-27', cat: 'تقنية',
    excerpt: 'نعيش في وقتنا الراهن ضمن سياق تشريعات محلية تضبط لنا الكثير من الانحرافات وتشرع الرقابة على الجميع من أجل تنظيم حياتنا بشكل عام.. والشعور بالأمان..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201703-004', title: 'ماذا سيحدث لو تحررت التكنولوجيا من الرأسمالية؟', date: '27 مارس 2017', iso: '2017-03-27', cat: 'تقنية',
    excerpt: 'في الكثير من المناسبات نذهب لشراء الهدايا.. وقد نحتار في اختيار الهدية ونوعها.. فمثلاً كنت جالساً في مسائي وحائراً بشراء هدية لأخي الصغير..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201702-001', title: 'هل أصبحت التكنولوجيا أحد مقومات الراحة؟', date: '28 فبراير 2017', iso: '2017-02-28', cat: 'تقنية',
    excerpt: 'في السابق كنا نبذل جهداً كبيراً في العمل أو الدراسة أو في المباني الحكومية أو في أي منحى من مناحي الحياة.. فكل شيء كان يدوي .. ويعتمد على الجهد الخاص..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201702-002', title: 'إدمان الهاتف … أم غربة', date: '28 فبراير 2017', iso: '2017-02-28', cat: 'التربية',
    excerpt: 'أصبحت مجتمعاتنا تعاني من غربة باتت من واقعنا.. غربة رغم ما فيها من مقومات وعوامل الترفيه والتسلية.. ولكن ..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201702-003', title: 'قصور التشريعات المحلية عن مواكبة التكنولوجيا', date: '28 فبراير 2017', iso: '2017-02-28', cat: 'تقنية',
    excerpt: 'عندما كنا صغاراً حتى المراهقة ينتابنا الخوف عند القيام بأي تجاوز حتى لو كان بسيطاً.. وكنا نعلم أن هناك رادع وهو العقاب لكل تجاوز.. سواء على المستوى الأسري أو المجتمعي..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201702-004', title: 'هل التقدم التكنولوجي سيوفر لك الإحساس بالأمان', date: '28 فبراير 2017', iso: '2017-02-28', cat: 'تقنية',
    excerpt: 'في أحد الأسواق كنت أشتري بعض الحاجيات.. فاستوقفني أحد الأشخاص.. ينظر لي ويبتسم ويقول لي "شلونك يا ويه الخير".. وفي الحقيقة كنت أنظر لهذا الشخص وأراه في مخيلتي..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201612-001', title: 'هل العبرة في صحة الخبر… أم كثرة المتابعين', date: '21 ديسمبر 2016', iso: '2016-12-21', cat: 'إعلام',
    excerpt: 'عند الفطور كنت أجلس أتناول صحيفتي مع فنجان الشاي، وإذا كان هناك بعض الوقت أرى المجلة لأستطلع أخبار العالم، والأخبار الأخرى التي تشدني، وكنت أقرأها دون أن ينتابني شك صحة الخبر، وفي المساء أجلس لأشاهد ا',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201612-002', title: 'إلى أي مدى يمكن أن تذهب التكنولوجيا بالتعليم؟', date: '21 ديسمبر 2016', iso: '2016-12-21', cat: 'التعليم',
    excerpt: 'أجلس كثيراً أمام القناة الوثائقية.. أتقلب معها في وثائقياتها المثيرة.. أجد فيها العديد من التساؤلات التي تخالج نفسي وقد تخالج أنفسكم أنتم أيضاً..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201612-003', title: 'زخم المعلومات يفقد الدماغ صوابه', date: '21 ديسمبر 2016', iso: '2016-12-21', cat: 'تقنية',
    excerpt: 'لقرون طويلة من الزمن، اعتمد البشر على بعضهم البعض في الحـصول على المعلومات ونقلها من جـيل إلى آخر، وكان للذاكرة شأن كبير في هذا الأمر..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201612-004', title: 'توليد الثقافة –ما بين الأمس والحاضر', date: '21 ديسمبر 2016', iso: '2016-12-21', cat: 'مجتمع',
    excerpt: 'بالأمس وفي زمن التلفزه الأولى كان جهاز واحد يجمع حوله جميع عناصر المجتمع وفئاته، وما يعرض في التلفزة يحدد ثقافة المجتمع، والراديو كان عنصر أساسي أيضاً لتعزيز الثقافة بين الناس، وقد شكلت عوامل جاذبة وم',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201611-002', title: 'سياسة الصانع تحدد ثقافة المنتج', date: '30 نوفمبر 2016', iso: '2016-11-30', cat: 'تقنية',
    excerpt: 'منذ فترة شهدت القنوات الفضائية خاصة الكويتية، الحدث البارز الانتخابات النيابية، وكان هناك لقاءات مع المنتخبين للمجلس والتابعين والناخبين، ورأينا مشاهد كثيرة لحضور ندوات وخطابات المنتخبين وأتباعهم وناخ',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201611-003', title: 'التناظر بين الواقع الحقيقي والواقع الافتراضي في الفيس بوك ٢', date: '30 نوفمبر 2016', iso: '2016-11-30', cat: 'تقنية',
    excerpt: 'وأنا أقف على الإشارة أمسك الجوال كلما سمعت صوت إشعارات أصدقاء الفيس بوك،، ولما التفت جانباً تفاجأت بصديق الطفولة وهو يمسك جواله أيضاً، وفتحت الإشارة وانطلقنا،، للأسف هذا أصبح واقع أصدقاء العمر..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201611-004', title: 'التناظر بين الواقع الحقيقي والواقع الافتراضي في الفيس بوك', date: '30 نوفمبر 2016', iso: '2016-11-30', cat: 'تقنية',
    excerpt: 'صديقنا الصدوق، هذا صديق الطفولة لعبنا وترعرعنا معاً، وتسوق بنا السنين لنصبح في مقاعد الدراسة، وخرجنا إلى سوق العمل في خطى واحدة، تخطينا معاً كل الصعاب، وأخذنا قراراتنا معاً، يكفي أن حلمنا واحد مع قسطا',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201611-005', title: 'أصدقاء العالم الافتراضي… نعمة أم نقمة', date: '30 نوفمبر 2016', iso: '2016-11-30', cat: 'تقنية',
    excerpt: 'هل الشارع أخطر على أبنائنا أم العالم الافتراضي؟..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
  { slug: 'qabas-201611-001', title: 'ثقافة تغزو التكنولوجيا أم تكنولوجيا تغزو الثقافة', date: '29 نوفمبر 2016', iso: '2016-11-29', cat: 'إعلام',
    excerpt: 'في صغري كنت أشاهد في بعض أفلام الخيال العلمي..',
    url: '', source: 'https://www.alqabas.com/author/332/' },
]

export const articleCats = ['الكل','التعليم','التربية','مجتمع','تقنية','هوية','إعلام','بحث']

/** المقالات مع نصوصها الكاملة (إن وُجدت في bodies.json) */
export type Article = (typeof articles)[number] & { body?: string }
export const articlesWithBody: Article[] = articles.map((a) => ({
  ...a,
  body: (bodies as Record<string, string>)[a.slug] || undefined,
}))

/** إحصاءات حيّة — تُحسب من المحتوى نفسه، لا تُكتب يدوياً */
export const stats = {
  articles: articles.length,
  words: Object.values(bodies as Record<string, string>).reduce((n, t) => n + t.trim().split(/\s+/).length, 0),
  years: new Set(articles.map((a) => a.iso.slice(0, 4))).size,
}

// الظهور الإعلامي — لقاءات تلفزيونية (مسحوبة من الموقع)
export const media = [
  { title: 'لقاء في برنامج «معاكم» على تلفزيون دولة الكويت حول مشروع التعليم عن بعد', outlet: 'تلفزيون الكويت', url: 'https://www.youtube.com/watch?v=ydhZ9IcGaVc' },
  { title: 'لقاء في تلفزيون الكويت — تكنولوجيا التعليم', outlet: 'تلفزيون الكويت', url: 'https://www.youtube.com/watch?v=MdMDpX9jwTU' },
  { title: 'برنامج «البيت العود» على قناة إثراء — مفهوم تكنولوجيا التعليم', outlet: 'قناة إثراء', url: 'https://www.youtube.com/watch?v=UsO9ju--z2M' },
  { title: 'برنامج «مساء الخير يا كويت» — حديث حول تكنولوجيا التعليم', outlet: 'تلفزيون الكويت', url: 'https://www.youtube.com/watch?v=x_nNolE8DuM' },
  { title: 'برنامج «حدد مسارك» — نصائح للشباب (2): المهارات', outlet: 'حدد مسارك', url: 'https://www.youtube.com/watch?v=cOlGZibqDiw' },
  { title: 'برنامج «حدد مسارك» — نصائح للشباب', outlet: 'حدد مسارك', url: 'https://www.youtube.com/watch?v=-6BvLvZqTik' },
]

// المشاريع التقنية
export const projects = [
  { title: 'E-Attendance', desc: 'أول برنامج عربي لحضور الطلبة عبر تقنية QR Code — متوفر في App Store و Google Play.' },
  { title: 'نظام الجدول الدراسي', desc: 'أول برنامج في الكويت لتسهيل إعداد الجدول الدراسي للكليات والأقسام العلمية.' },
]

// أطروحة الدكتوراه
export const doctorate = {
  title: 'Education Management and Design System: Use of Internet-based Social Learning Network as a Tool to Support High School Teaching Staff in Kuwait',
  university: 'جامعة شمال كولورادو — غريلي، كولورادو',
  note: 'دكتوراه الفلسفة في التربية، تخصص تكنولوجيا التعليم — بدرجة امتياز مع مرتبة الشرف.',
}

// أبرز العضويات الدولية
export const memberships = [
  'الجمعية الدولية لتكنولوجيا التعليم (ISTE)',
  'جمعية الاتصالات التربوية والتكنولوجيا (AECT)',
  'Golden Key International Honour Society',
  'Pi Lambda Theta — الأكثر انتقائية في التربية',
  'جمعية التعليم عن بُعد الأمريكية (USDLA)',
  'رابطة أمريكا الشمالية للتربية البيئية (NAAEE)',
  'مركز مايكروسوفت للمعلمين (MIE)',
  'رابطة القيادة التربوية (ALE)',
]

// المؤتمرات والزيارات العلمية
export const conferences = [
  { title: 'المؤتمر الدولي للتعليم عن بعد والتعلّم الافتراضي', place: 'ميلانو، إيطاليا' },
  { title: 'مؤتمر المجتمعات والتكنولوجيا (C&T)', place: 'ميونخ، ألمانيا' },
  { title: 'التكنولوجيا في عالم التعليم', place: 'كوالالمبور، ماليزيا' },
  { title: 'كيف يمكن للتكنولوجيا أن تخدم العملية التعليمية', place: 'دبي، الإمارات' },
  { title: 'التكنولوجيا في الاقتصاد والمؤسسات', place: 'إسطنبول، تركيا' },
  { title: 'Maker Faire Kuwait — كلمة رئيسية', place: 'الكويت' },
  { title: 'Mini Maker Faire Dubai — كلمة رئيسية', place: 'الإمارات' },
  { title: 'مؤتمر جامعة قطر — كلمة رئيسية', place: 'قطر' },
]

// المناصب الاستشارية
export const advisory = [
  { role: 'خبير ومستشار مكتب الوزير', org: 'وزارة الإعلام' },
  { role: 'مستشار', org: 'المجلس الوطني للثقافة والفنون والآداب' },
  { role: 'مستشار', org: 'مكتبة الكويت الوطنية' },
  { role: 'خبير ومستشار — المشرف العام لبرنامج «مثمر»', org: 'الهيئة العامة للشباب' },
  { role: 'مستشار معرض الصنّاع العالمي Maker Faire', org: 'الشركة الكويتية للاستثمار' },
  { role: 'مدرب ومستشار', org: 'أكاديمية الصنّاع' },
]

// ✨ «الأحدث» — بطاقة واحدة في الصفحة الرئيسية.
// حدّثها عند نشر أي جديد (مقال / فيديو / بحث). لاحقاً: تُحسب تلقائياً من Firestore.
export const latest = {
  kind: 'مقال',                    // مقال · فيديو · بحث · كتاب
  title: articles[0].title,
  to: '/articles',                 // مسار الصفحة الداخلية
}

/* ============================================================
   المختارات — «من اختياراتي» (بنية الموقع القديم)
   عنصر واحد فقط لكل تصنيف = الأحدث. أضِف/عدّل هنا، أو اربطه بـ Firestore.
   ============================================================ */
export type Pick = {
  cat: string          // اسم التصنيف
  group: string        // المجموعة
  title: string        // العنوان أو الاقتباس
  note?: string        // سطر توضيحي
  url?: string         // رابط خارجي (اختياري)
  date?: string        // تاريخ التحديث
}

export const curatedGroups = [
  { key: 'reading',  label: 'غرفة القراءة',              cats: ['كتاب الشهر', 'مقالة تستحق القراءة', 'بحث علمي'] },
  { key: 'watch',    label: 'شاهد واستمع',                cats: ['فيديو مختار', 'مقطع صوتي', 'من منصة X'] },
  { key: 'thought',  label: 'فكر وتأمّل',                 cats: ['اقتباس وتأمّل', 'تجربة فكرية', 'سؤال مزلزل', 'إعادة صياغة', 'حكمة صامتة', 'ما وراء الفكرة'] },
  { key: 'visual',   label: 'المنطقة البصرية',            cats: ['رؤية بصرية', 'إنفوجرافيك', 'خريطة ذهنية', 'خريطة المعنى', 'صورة تغني عن الكلام'] },
  { key: 'ai',       label: 'الذكاء الاصطناعي والأدوات',  cats: ['أداة الأسبوع', 'ركن الملخصات', 'مفهوم ناشئ', 'رصد الاتجاهات', 'منصة أوصي بها'] },
  { key: 'insights', label: 'رؤى منتقاة',                 cats: ['من بريدي الوارد', 'مكتبة صغيرة', 'مكتبة صغيرة: الذكاء الاصطناعي والمجتمع', 'ما وراء الاقتباس', 'رؤية خاطفة'] },
  { key: 'society',  label: 'التعليم والمجتمع',           cats: ['المصطلح الذي أُسيء فهمه', 'ما لا تعلّمه المدارس', 'تسليط الضوء على الابتكار', 'إحياء اللغة العربية', 'قابل للنقاش'] },
]

// ✏️ املأ هذه القائمة بمختاراتك. اتركها فارغة وسيظهر «قريباً» بأناقة.
export const picks: Pick[] = [
  { cat: 'اقتباس وتأمّل', group: 'thought', title: '«التعليم إيقادُ شعلة، لا ملءُ وعاء.»', note: 'وليم بتلر ييتس' },
  { cat: 'كتاب الشهر', group: 'reading', title: 'موسوعة تكنولوجيا التعليم', note: 'عملٌ مرجعي في تكنولوجيا التعليم' },
  { cat: 'سؤال مزلزل', group: 'thought', title: 'ماذا لو كان الامتحان يقيس الخوف، لا الفهم؟' },
  { cat: 'أداة الأسبوع', group: 'ai', title: 'أدوات الذكاء الاصطناعي في إعداد الدروس', note: 'توصية أسبوعية' },
]

/* ============================================================
   السيرة الأكاديمية الكاملة (من الموقع الأصلي)
   ============================================================ */
export const bio = {
  intro:
    'حاصل على درجة دكتوراه الفلسفة في التربية، تخصص تكنولوجيا التعليم. صاحب مهارات ممتازة في التدريس وحل المشكلات، وتطوير وإدارة المشاريع، وإعداد وتطوير المناهج، فضلاً عن جمع البيانات والبحث والتحليل، مع القدرة على التحدث بطلاقة بالإنجليزية والعربية.',

  education: [
    { degree: 'دكتوراه الفلسفة في التربية — تكنولوجيا التعليم', org: 'جامعة شمال كولورادو، غريلي، كولورادو', note: 'بدرجة امتياز مع مرتبة الشرف' },
    { degree: 'ماجستير في تكنولوجيا التعليم', org: 'جامعة شمال كولورادو', note: 'بدرجة امتياز مع مرتبة الشرف' },
    { degree: 'بكالوريوس التربية في تكنولوجيا التعليم', org: 'الهيئة العامة للتعليم التطبيقي والتدريب (PAAET)', note: 'بدرجة امتياز مع مرتبة الشرف' },
  ],

  teaching: [
    { role: 'أستاذ مشارك — يناير 2020 حتى الآن', org: 'كلية التربية الأساسية · PAAET' },
    { role: 'أستاذ مساعد — حتى يناير 2020', org: 'كلية التربية الأساسية · PAAET' },
    { role: 'أستاذ منتدب في كلية التربية', org: 'جامعة الكويت' },
  ],

  work: [
    { role: 'خبير ومستشار مكتب الوزير', org: 'وزارة الإعلام' },
    { role: 'مستشار', org: 'المجلس الوطني للثقافة والفنون والآداب' },
    { role: 'مستشار', org: 'مكتبة الكويت الوطنية' },
    { role: 'خبير ومستشار', org: 'الهيئة العامة للشباب', items: ['المشرف العام لبرنامج «مثمر» الوطني', 'عضو اللجنة العليا للمبادرات', 'عضو جائزة الكويت للتميز والإبداع الشبابي', 'عضو فريق ابتكار', 'مدير المجتمع في وادي الشباب'] },
    { role: 'مستشار معرض الصنّاع العالمي Maker Faire', org: 'الشركة الكويتية للاستثمار' },
    { role: 'مدرب ومستشار', org: 'أكاديمية الصنّاع', items: ['الإدارة والقيادة', 'التعليم', 'تكنولوجيا التعليم'] },
  ],

  committees: [
    'عضو رابطة أعضاء هيئة التدريس — الكويت',
    'عضو اللجنة العليا للتحول الرقمي — PAAET',
    'مقرر لجنة تطوير البرامج والمناهج — قسم تكنولوجيا التعليم',
    'عضو لجنة البحوث — كلية التربية الأساسية',
    'عضو لجنة ضبط الجودة والاعتماد الأكاديمي',
    'عضو لجنة البعثات — قسم تكنولوجيا التعليم',
    'عضو لجنة البحث العلمي — قسم تكنولوجيا التعليم',
    'عضو لجنة الجدول وسير الامتحانات',
    'محكّم في عدة أبحاث ودراسات أكاديمية',
    'محكّم في مسابقة Heading Global',
    'عضو جمعية المعلمين الكويتية',
    'عضو جمعية الصحفيين الكويتية',
    'مدير قطاع التعليم والمناهج — Big Brains',
    'مدير البرمجة والشبكات — CTG',
  ],

  workshops: [
    'المهارات تدمّر العقل — عمّان',
    'أوقفوا التعلم عن بعد حالاً — الكويت',
    'التطبيقات التربوية والتعليمية — الكويت',
    'العمل الجماعي الإبداعي — بنك الكويت المركزي',
    'التسويق التكنولوجي — غرفة التجارة والصناعة',
    'تكنولوجيا التعليم — وزارة الشباب',
    'التكنولوجيا الأسرية — ملتقى ديسكفري الثاني',
    'روح الفريق الواحد — الدورة التأسيسية لإعداد المذيعين',
    'مهارات الاتصال — الكويت وكوالالمبور',
    'مهارات التخطيط الاستراتيجي — الكويت',
    'صنع القرار — الكويت والسعودية',
    'مهارات إدارة الوقت — الكويت والسعودية',
  ],

  certifications: [
    'معتمد من Microsoft Innovative Educator (MIE)',
    'تعلّم التصميم في القرن الحادي والعشرين (21CLD) — الدورات 1–7',
    'سلسلة Microsoft Teams — الدورات 1–5',
    'Minecraft Education — المسار الكامل + ساعة تميّز',
    'مستويات STEM الأول والثاني والثالث',
    'LEGO® MINDSTORMS® Education EV3 — المسار الكامل',
    'تطبيقات التعليم الذكي — جامعة حمدان، الإمارات',
    'الرخصة الدولية لقيادة الحاسب الآلي (ICDL)',
    'إنترنت الأشياء — الكويت',
    'التصنيع الرقمي التعليمي — الكويت',
    'أدوات التلعيب التعليمية التكنولوجية — الكويت',
    'أساسيات الصحة النفسية — الكويت',
  ],

  skills: ['تحليل البرمجيات', 'فوتوشوب', 'تحرير الفيديو', 'MAC · WIN', 'تحليل البحوث والبيانات (SPSS)'],
}

/* ============================================================
   📸 الصور الاحترافية
   ضع الملفات في: src/assets/  ثم فعّل الأسطر أدناه في الصفحات.
   المقاسات المثالية:
     hero     — عمودي 4:5  (1600×2000) — بورتريه درامي
     about    — أفقي 3:2   (2000×1333) — أثناء المحاضرة
     books    — أفقي 16:9  (2400×1350) — الكتب التسعة مصفوفة
     cv       — عمودي 3:4  (1200×1600) — رسمي هادئ
   الصيغة: .webp (جودة 82). احتفظ بنسخة .jpg احتياطية.
   ============================================================ */
export const photos = {
  hero: '',    // مثال: '/src/assets/hero.webp'
  about: '',
  books: '',
  cv: '',
}

/* ============================================================
   اللقاءات القادمة — أضِف لقاءً هنا فيظهر تلقائياً.
   اتركها فارغة وتظهر رسالة أنيقة بدل فراغ ميّت.
   ============================================================ */
export type Event = {
  title: string
  org: string
  place: string
  date: string        // للعرض
  iso: string         // YYYY-MM-DD — للترتيب وحساب «انقضى»
  time?: string
  url?: string        // رابط التسجيل
  kind?: string       // محاضرة · ورشة · مؤتمر · لقاء
}

export const upcoming: Event[] = [
  // مثال (احذفه واستبدله):
  // { title: 'ورشة: الذكاء الاصطناعي في التقييم التربوي', org: 'كلية التربية الأساسية',
  //   place: 'الكويت', date: '12 سبتمبر 2026', iso: '2026-09-12', time: '6:00 م',
  //   kind: 'ورشة', url: 'https://schedule.dr-alfailakawi.com/' },
]

/* ============================================================
   من بريدي الوارد
   ============================================================ */
export const testimonials = [
  { quote: 'أعجبني قولك إن التعليم ليس معلومات بل صناعة معنى، هذه جملة أحتفظ بها على مكتبي.' },
  { quote: 'دكتور أحمد، مقالتك الأخيرة جعلتني أعيد التفكير في طريقة تربية أطفالي، شكراً لأنك تكتب بهذا العمق.' },
]

export const inboxLinks = [
  { title: 'معهد استشراف المستقبل — Dell (2017)',
    note: 'العصر التالي لشراكات الإنسان–الآلة · تقدير: 85٪ من وظائف 2030 لم تُخترع بعد',
    url: 'https://www.delltechnologies.com/content/dam/delltechnologies/assets/perspectives/2030/pdf/SR1940_IFTFforDellTechnologies_Human-Machine_070517_readerhigh-res.pdf' },
  { title: 'محاضرة TED — كيف نعيد تعريف النجاح في المدارس',
    note: 'نظرية العلامات الخمس',
    url: 'https://www.ted.com/talks/elizabeth_caslin_redefining_student_success_using_the_5_labels_theory' },
  { title: 'تقرير اليونسكو 2024 — مستقبل التعليم في العالم',
    note: 'وثيقة مرجعية',
    url: 'https://unesdoc.unesco.org/ark:/48223/pf0000381794' },
]

export const faqs = [
  { q: 'ما أفضل طريقة لتعريف الطفل بالتكنولوجيا دون أن يدمنها؟',
    a: 'القاعدة الذهبية: شارك قبل أن تراقب. اجعل التكنولوجيا وسيلة للخلق والإبداع لا مجرد ترفيه.' },
  { q: 'هل التعليم التقليدي انتهى؟',
    a: 'التعليم التقليدي لم ينتهِ، لكنه يحتاج إلى ثورة فكرية تجعل الطالب محور العملية التعليمية لا مجرد متلقٍّ.' },
  { q: 'كيف أختار تخصصي الجامعي في زمن يتغيّر بسرعة؟',
    a: 'ابدأ من قيمك قبل ميولك، ثم اربط ذلك بالاتجاهات العالمية وسوق العمل المستقبلي. لا تجعل الشهادة هدفاً، بل وسيلة لاكتساب مهارات حياتية ومهنية.' },
]

/* ============================================================
   حول الموقع — بنصّه الأصلي
   ============================================================ */
export const aboutSite = {
  hero: 'مرحباً بك في فضاءٍ مُنتقى بعناية… حيث لكل قسم غاية، ولكل اختيار فلسفة.',
  sections: [
    { title: 'الرؤية والهدف',
      body: 'هذا الموقع ليس مجرد سيرة ذاتية… بل تجربة فكرية، ومختبر تربوي مفتوح. أنشأته ليكون نافذتي الصادقة إلى القارئ النبيل، والباحث عن المعنى، وصاحب القرار الذي لا تكتبه الأرقام دون بصيرة.' },
    { title: 'لماذا هذا الموقع؟',
      body: 'لأني أؤمن أن الكلمة يجب أن تتحرّر من أرشيف المجلات والمؤتمرات… وتصل إلى يد من يحتاجها. ولأن التعليم اليوم بحاجة إلى صوت مختلف… لا يساير، بل يُثير.' },
  ],
  distinct: [
    'يُعرض فيه مشروعي الأكاديمي والفكري بلغة قريبة وعميقة.',
    'يضمّ مقالاتي الشخصية والفكرية المنشورة في الصحافة والمجلات العلمية، لا مقالات عامة أو ترويجية.',
    'يتضمّن أرشيفاً مختاراً من اللقاءات والدورات والمحاضرات والمقاطع المؤثرة.',
    'يُقدّم قسماً نادراً بعنوان «من اختياراتي» — مواقع ومصادر وأدوات ومفاهيم موثوقة، مختارة بعين ناقدة لا تُروّج بل تُرشّد.',
  ],
  audience: [
    'للطالب الذي يحتاج إلى دليل موثوق في عالم مشتّت',
    'للمعلم الذي يبحث عن تطوير حقيقي يتجاوز الدورات المكرّرة',
    'للمهتم بالتعليم، الذي لم يجد بعد ما «يَهُزّهُ» بصدق',
    'ولصاحب القرار الذي يبحث عن فكر مؤسسي… لا انفعالي',
  ],
  creed: [
    'هذا الموقع لا يضع كل شيء، بل يختار الأهم.',
    'لا يقدّم كل ما يُنشر، بل ما يستحق أن يُحفّز، يُربك، ويُفكّر.',
    'لا يدّعي الكمال… بل يُمثّل محاولة ناضجة لتقريب الفكر من الحياة.',
  ],
}

/* الموقع الجغرافي */
export const place = {
  label: 'كلية التربية الأساسية — بوابة 7',
  city: 'الكويت',
  mapEmbed:
    'https://maps.google.com/maps?q=%D9%83%D9%84%D9%8A%D8%A9%20%D8%A7%D9%84%D8%AA%D8%B1%D8%A8%D9%8A%D8%A9%20%D8%A7%D9%84%D8%A3%D8%B3%D8%A7%D8%B3%D9%8A%D8%A9%20%D8%A8%D9%88%D8%A7%D8%A8%D9%87%D8%A7%20gate%207&t=m&z=15&output=embed&iwloc=near',
}

/* النشرة البريدية — ضع رابط المزوّد (Mailchimp / Buttondown / Formspree) */
export const NEWSLETTER_ENDPOINT = '' // مثال: 'https://formspree.io/f/xxxxxxx'

/* بيانات الموقع لمحرّكات البحث */
export const site = {
  url: 'https://dr-alfailakawi.com',
  title: 'د. أحمد الفيلكاوي — أستاذ تكنولوجيا التعليم',
  description:
    'الموقع الرسمي للدكتور أحمد حسين الفيلكاوي، أستاذ تكنولوجيا التعليم والذكاء الاصطناعي. تسعة كتب، ثمانية عشر بحثاً محكّماً، وأكثر من 160 مقالاً فكرياً في التعليم والتقنية والمجتمع.',
  ogImage: '/og.png',
}
