from blackpy import Actor, stage

stage.background("court")
player = Actor("cat", x=-240, y=-80, name="선수", scale=1.2)
ball = Actor("ball", x=-170, y=-180, name="공", scale=0.7)

stage.say("공을 몇 번 튀기는지 세어 보세요!")
stage.dribble(
    player, ball,
    bounces=4,
    height=100,
    distance=360,
)

stage.say("통통! 드리블을 마쳤어요.")
print("공이 얼마나 높이 올라갔나요?")
