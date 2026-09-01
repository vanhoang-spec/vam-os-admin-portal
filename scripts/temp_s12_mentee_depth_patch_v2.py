from pathlib import Path

worker = Path("scripts/temp_s12_mentee_depth_patch.py")
source = worker.read_text(encoding="utf-8")

bad_old = '''        <TextAreaField
            name="current_difficulty_text"
            label="Khó khăn cụ thể bạn đang cần mentor hỗ trợ"
            rows={3}
          />'''
good_old = '''        <TextAreaField
          name="current_difficulty_text"
          label="Khó khăn cụ thể bạn đang cần mentor hỗ trợ"
          rows={3}
        />'''

bad_new = '''        <TextAreaField
            name="current_difficulty_text"
            label="Khó khăn cụ thể bạn đang cần mentor hỗ trợ"
            required
            minLength={100}
            rows={4}
            helpText="Tối thiểu ~100 ký tự. Nêu tình huống cụ thể, điều bạn đã thử và điều bạn mong Mentor hỗ trợ."
          />'''
good_new = '''        <TextAreaField
          name="current_difficulty_text"
          label="Khó khăn cụ thể bạn đang cần mentor hỗ trợ"
          required
          minLength={100}
          rows={4}
          helpText="Tối thiểu ~100 ký tự. Nêu tình huống cụ thể, điều bạn đã thử và điều bạn mong Mentor hỗ trợ."
        />'''

if source.count(bad_old) != 1 or source.count(bad_new) != 1:
    raise SystemExit("temporary worker source does not match the reviewed v1 shape")

source = source.replace(bad_old, good_old, 1).replace(bad_new, good_new, 1)
exec(compile(source, str(worker), "exec"), {"__name__": "__main__"})
