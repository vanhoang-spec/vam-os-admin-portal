"use client";

import { useFormState } from "react-dom";

import { updateMktBrandAction, updateMktChannelAction } from "@/app/actions/mkt";
import { initialMktActionState } from "@/lib/mkt-action-types";
import { CHANNEL_LABELS, isOptionalChannel, type MktChannel } from "@/lib/mkt-core";
import { Feedback, Field, inputClass, SubmitButton } from "./mkt-ui";

/**
 * The settings tab.
 *
 * Two things live here and they are separate on purpose. The brand profile is
 * the shared voice of the space; the channel briefs are who each channel is
 * for. Editing the voice should never mean touching the channel that speaks to
 * a different audience.
 *
 * The brand NAME is not editable here — it is the programme's own name, read
 * from the programme record, and shown so people can see what the model will
 * be told.
 */

export type ChannelView = {
  channel: MktChannel;
  isActive: boolean;
  postsPerWeek: number;
  bestTimes: string[];
  audience: string | null;
  topics: string | null;
  doWrite: string | null;
  avoidWrite: string | null;
  distinctAudience: boolean;
};

export function BrandPanel({
  spaceId,
  brandName,
  pageUrl,
  notes,
  brand
}: {
  spaceId: string;
  brandName: string;
  pageUrl: string | null;
  notes: string | null;
  brand: {
    description?: string | null;
    audience?: string | null;
    voice?: string | null;
    pillars?: Array<{ name?: string; ratio?: number | null }>;
    cta?: string[];
    hashtags?: string[];
    doList?: string[];
    avoidList?: string[];
    diagnosis?: string | null;
  };
}) {
  const [state, formAction] = useFormState(updateMktBrandAction, initialMktActionState);

  const pillars = brand.pillars?.length ? brand.pillars : [{ name: "", ratio: null }];
  const rows = [...pillars, { name: "", ratio: null }].slice(0, 8);

  return (
    <section className="space-y-4 rounded-lg border border-vam-line bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-vam-ink">Hồ sơ thương hiệu</h2>
        <p className="mt-1 max-w-2xl text-sm text-vam-muted">
          Tên dùng trong mọi bài viết là <strong className="text-vam-ink">{brandName}</strong> — lấy
          thẳng từ tên chương trình trong hệ thống, không gõ tay ở đây, nên không bao giờ lệch.
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="space_id" value={spaceId} />

        <Field label="Trang đăng bài" hint="Link fanpage. Chỉ để người phụ trách mở nhanh khi tới giờ đăng.">
          <input name="page_url" type="url" defaultValue={pageUrl ?? ""} className={inputClass} />
        </Field>

        <Field label="Mô tả chương trình">
          <textarea name="description" rows={3} defaultValue={brand.description ?? ""} className={inputClass} />
        </Field>

        <Field label="Đối tượng">
          <textarea name="audience" rows={2} defaultValue={brand.audience ?? ""} className={inputClass} />
        </Field>

        <Field label="Giọng văn" hint="Xưng hô, nhịp câu, điều không bao giờ làm.">
          <textarea name="voice" rows={3} defaultValue={brand.voice ?? ""} className={inputClass} />
        </Field>

        <fieldset>
          <legend className="text-sm font-medium text-vam-ink">Trụ cột nội dung và tỷ lệ</legend>
          <p className="mt-0.5 text-xs text-vam-muted">
            Tỷ lệ là thứ giữ cho một tuần cân bằng thay vì bảy bài cùng một kiểu.
          </p>
          <div className="mt-2 space-y-2">
            {rows.map((pillar, index) => (
              <div key={index} className="flex gap-2">
                <input
                  name="pillar_name"
                  defaultValue={pillar.name ?? ""}
                  placeholder="Tên trụ cột"
                  maxLength={120}
                  className="flex-1 rounded-md border border-vam-line px-3 py-2 text-sm"
                />
                <input
                  name="pillar_ratio"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={pillar.ratio ?? ""}
                  placeholder="%"
                  className="w-20 rounded-md border border-vam-line px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>
        </fieldset>

        <Field label="Kêu gọi hành động" hint="Mỗi dòng một câu.">
          <textarea name="cta" rows={3} defaultValue={(brand.cta ?? []).join("\n")} className={inputClass} />
        </Field>

        <Field label="Hashtag" hint="Mỗi dòng một thẻ.">
          <textarea
            name="hashtags"
            rows={3}
            defaultValue={(brand.hashtags ?? []).join("\n")}
            className={inputClass}
          />
        </Field>

        <Field label="Nên làm" hint="Mỗi dòng một điều.">
          <textarea
            name="do_list"
            rows={3}
            defaultValue={(brand.doList ?? []).join("\n")}
            className={inputClass}
          />
        </Field>

        <Field label="Tránh" hint="Mỗi dòng một điều.">
          <textarea
            name="avoid_list"
            rows={3}
            defaultValue={(brand.avoidList ?? []).join("\n")}
            className={inputClass}
          />
        </Field>

        <Field
          label="Hiện trạng trang"
          hint="Đọc 10–15 bài gần nhất rồi ghi thẳng vào đây. Không có dòng này, AI chép lại nếp cũ vì nó chỉ nhìn thấy nếp cũ."
        >
          <textarea name="diagnosis" rows={4} defaultValue={brand.diagnosis ?? ""} className={inputClass} />
        </Field>

        <Field label="Ghi chú nội bộ">
          <textarea name="notes" rows={2} defaultValue={notes ?? ""} className={inputClass} />
        </Field>

        <Feedback state={state} />
        <SubmitButton label="Lưu hồ sơ" pendingLabel="Đang lưu…" />
      </form>
    </section>
  );
}

export function ChannelPanel({
  spaceId,
  channel,
  weeklyLoad
}: {
  spaceId: string;
  channel: ChannelView;
  weeklyLoad: number;
}) {
  const [state, formAction] = useFormState(updateMktChannelAction, initialMktActionState);
  const label = CHANNEL_LABELS[channel.channel] ?? channel.channel;

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-vam-line bg-white p-4">
      <input type="hidden" name="space_id" value={spaceId} />
      <input type="hidden" name="channel" value={channel.channel} />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-vam-ink">{label}</h3>
        <span className="text-xs text-vam-muted">
          {channel.isActive ? `Đang bật · tổng ${weeklyLoad} bài/tuần cho cả không gian` : "Đang tắt"}
        </span>
      </div>

      {isOptionalChannel(channel.channel) && !channel.isActive ? (
        <p className="rounded-md bg-[#f7faf8] px-3 py-2 text-xs text-vam-muted">
          Kênh này là tuỳ chọn. Bật khi team quyết định chạy — bài cũ không bị ảnh hưởng nếu sau này
          tắt lại.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Bật kênh">
          <select name="is_active" defaultValue={String(channel.isActive)} className={inputClass}>
            <option value="false">Tắt</option>
            <option value="true">Bật</option>
          </select>
        </Field>

        <Field label="Số bài mỗi tuần" hint="Tối đa 7 — mỗi ngày nhiều nhất một bài.">
          <input
            name="posts_per_week"
            type="number"
            min={0}
            max={7}
            defaultValue={channel.postsPerWeek}
            className={inputClass}
          />
        </Field>

        <Field label="Giờ vàng" hint="Cách nhau bằng dấu phẩy, dạng 20:00.">
          <input name="best_times" defaultValue={channel.bestTimes.join(", ")} className={inputClass} />
        </Field>
      </div>

      <Field label="Người đọc kênh này">
        <input name="audience" defaultValue={channel.audience ?? ""} maxLength={1000} className={inputClass} />
      </Field>

      <Field label="Chủ đề được viết">
        <input name="topics" defaultValue={channel.topics ?? ""} maxLength={1000} className={inputClass} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nên">
          <input name="do_write" defaultValue={channel.doWrite ?? ""} maxLength={1000} className={inputClass} />
        </Field>
        <Field label="Tránh">
          <input
            name="avoid_write"
            defaultValue={channel.avoidWrite ?? ""}
            maxLength={1000}
            className={inputClass}
          />
        </Field>
      </div>

      <label className="flex items-start gap-2 text-sm text-vam-ink">
        <input
          type="checkbox"
          name="distinct_audience"
          value="true"
          defaultChecked={channel.distinctAudience}
          className="mt-1"
        />
        <span>
          Kênh này nói với đối tượng khác hẳn các kênh còn lại
          <span className="mt-0.5 block text-xs text-vam-muted">
            Bật thì AI không bê ý tưởng của kênh khác sang. Sai đối tượng thì bài hay tới đâu cũng hỏng.
          </span>
        </span>
      </label>

      <Feedback state={state} />
      <SubmitButton label={`Lưu ${label}`} pendingLabel="Đang lưu…" tone="quiet" />
    </form>
  );
}
