from blackpy import Actor, stage

stage.background("track")
rabbit = Actor("rabbit", x=-260, y=80, name="토끼")
cat = Actor("cat", x=-260, y=-100, name="고양이")

rabbit.set_speed(120)
cat.set_speed(180)

stage.say("누가 먼저 도착할까요?")
stage.wait(1)
winner = stage.race(rabbit, cat, finish_x=260)

stage.say("경주 결과: " + winner)
print("경주 결과:", winner)
