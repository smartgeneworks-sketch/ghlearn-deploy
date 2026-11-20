# Verifying and processing learner manuals (live admin)

Live admin panel: https://ghlearn.com/admin. Every label below matches the live UI as of 15 Oct 2026.

**Who does what**
- **Super Admin:** can do every step.
- **Curriculum Admin or Editor:** edits details, processes manuals and generates content. Cannot approve.
- **Content Reviewer:** sets approval and reviews generated content. Cannot edit details, process or generate.
- **Separation of duties:** use two different accounts. The person who edits and processes a manual should not be the one who verifies it. Nobody can approve a lesson they created.

## 1. Open Learner Manuals and filter unverified
1. In the left sidebar, click **Learner Manuals**.
2. In **Library**, set the **Approval** filter to **unverified**. You can also set **Type** to **Learner manual** and choose a **Subject**.
3. To find a manual by name, type in **Search title, file name or tag** (for example `Year 1`).

**Choosing manuals:**
- Prefer **Learner Version (LV)** files of a single **Section**. They are small and have a text layer.
- OCR is not configured on the live server, so scanned pages yield no text.
- Skip duplicates. An "Identical file to …" notice means the copy shares a stored file with another document.

## 2. Open a manual, check the preview and the details, then edit
1. Click the manual's title.
2. Click **Preview original**.
   - The file is fetched from curriculumresources.edu.gh, which is slow, so allow up to a minute.
   - Check that the PDF is the official Ministry of Education / NaCCA manual and that the cover header (for example "Mathematics Year 1, Section 9") matches the title.
3. Under **Details and curriculum mapping**, check and correct these fields:

   | Field | What to set |
   |---|---|
   | **Title** | A readable title, e.g. "Mathematics Year 1, Section 9: Probability of Independent Events (Learner Version)" |
   | **Subject** | The SHS subject (General Science is the new name for Integrated Science) |
   | **Level** | Senior High School |
   | **Class / year of study** | The year on the cover header |
   | **Curriculum version** | **SHS 2023+**; subjects listed only under the source-site version (e.g. General Science) use **SHS 2023+ (source site)** |
   | **Document type** | Learner manual |
   | **Audience** | Learner |
   | **Source / publisher** | Ministry of Education, Ghana (NaCCA) |
   | **Source URL** | The curriculumresources.edu.gh file link |
   | **Publication year** | The year the PDF was produced |
   | **Licensing status** | **Restricted (no redistribution)**: MoE manuals say "All rights reserved", so only admins can download them; everyone else uses the preview |

   The Learning Area comes from the subject. Change it in **Academic Structure** if it is wrong.
4. Click **Save & confirm mapping**, or **Save details** to save without confirming.
5. Open **Original source metadata** to see what the import recorded.

## 3. Process or reprocess, and watch the processing monitor
1. In **Processing**, click **Process** (or **Reprocess** for a manual processed before), then **Queue processing** in the dialog.
2. The section shows *Queued* and then a progress bar.
3. Click **Inspect the latest processing job** for the stage timeline, error log and retry history. To see every run, use the **Document processing monitor** link at the top of Learner Manuals.
4. **Timing:** a 1 MB section takes about a minute.
5. **If the source site is slow:** you may see *Download failed: no response from curriculumresources.edu.gh within 60 s*. The job retries by itself up to three times. If it still fails, open the job and click **Retry**, then **Queue retry**.
6. **AI quota:** indexing uses no AI text-generation quota. It sends one embedding request per 50 passages, recorded under **AI Usage and Costs → Embeddings**.

## 4. Inspect the extracted pages
1. In **Extraction inspector**, every page should show method **text** and a sensible character count.
2. Click a page number (**Show page N**) to read its text next to the preview.
3. **Warning signs:**
   - pages marked **no text layer** (scanned pages, which need OCR);
   - a large count of very short pages;
   - text from a different subject or year.
4. **Detected structure** lists the section, strands and indicators that were found. Click **Verify** on the elements that are correct.

## 5. Set approval to verified
1. In **Approval**, click **Mark verified official**, then **Mark verified official** again in the dialog. Do this as the reviewer (or Super Admin), not the person who edited the manual.
2. **Before confirming, check:**
   - the file is the official one;
   - the extraction is readable;
   - the details are right.
3. **Reject** removes a manual from search and the tutor. **Reset to unverified** undoes a decision.
4. Approval never publishes anything.

## 6. Generate from AI Content Generation and send it for review
1. In the sidebar, click **AI Content Generation** to open the **AI generation workspace**.
2. Under **Generate content → What to create**, fill in:
   - **Content type:** for example *Full lesson (A–K)*;
   - **Subject**, **Topic** and **Year of study**;
   - **Curriculum version (optional)**.
3. After you choose the subject, **Source manuals (approved, current)** lists the verified manuals. Tick the one to use. **From page** and **To page** optionally limit the pages.
4. Check **Estimate before generating** before you generate:
   - **Requests:** a full lesson is normally 1 request (3 at most with retries).
   - **Daily budget:** the platform allows 40 requests a day.
5. Click **Generate lesson**. The draft opens when it is ready, in about a minute.
6. On the draft, read **Automatic checks**:
   - Every error must be fixed before submitting.
   - Edit a section and click **Save draft**, or regenerate just that section.
7. In **Review and publishing**, click **Submit for review**, then **Submit**.
   - The draft moves to **Content Review and Publishing**.
   - A different reviewer approves or requests changes.
   - Publishing is a separate, later step: nothing goes to students until someone clicks **Publish**.
